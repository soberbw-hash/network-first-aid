import path from "node:path";

import { getRepairAction, REPAIR_ACTIONS } from "../shared/action-catalog";
import type {
  ActionPreview,
  ActionResult,
  RepairActionDefinition,
  RepairActionId,
  RestoreResult,
  RestoreScope,
} from "../shared/contracts";
import { AuditService } from "./audit";
import { escapePowerShellSingleQuoted, runElevatedPowerShell, runPowerShell } from "./powershell";
import { getRepairScript } from "./repair-scripts";
import { SnapshotService } from "./snapshots";

const VALID_ACTION_IDS = new Set(REPAIR_ACTIONS.map((action) => action.id));
const VALID_RESTORE_SCOPES = new Set<RestoreScope>(["proxy", "dns", "hosts", "firewall"]);

const validateActionId = (value: unknown): RepairActionId => {
  if (typeof value !== "string" || !VALID_ACTION_IDS.has(value as RepairActionId)) {
    throw new Error("拒绝执行未列入白名单的操作");
  }
  return value as RepairActionId;
};

const runStandardPowerShell = async (body: string): Promise<string[]> => {
  const output = await runPowerShell(`
$logs = [System.Collections.Generic.List[string]]::new()
function Add-Log([string]$message) { $logs.Add($message) }
${body}
@($logs) | ConvertTo-Json -Compress
`);
  if (!output) return [];
  const parsed = JSON.parse(output) as string[] | string;
  return Array.isArray(parsed) ? parsed : [parsed];
};

export class RepairService {
  constructor(
    private readonly dataDirectory: string,
    private readonly snapshots: SnapshotService,
    private readonly audit: AuditService,
  ) {}

  list(): RepairActionDefinition[] {
    return REPAIR_ACTIONS;
  }

  preview(rawActionId: unknown): ActionPreview {
    const action = getRepairAction(validateActionId(rawActionId));
    const warnings: string[] = [];
    if (action.risk === "medium") warnings.push("执行期间网络可能短暂中断");
    if (action.risk === "high") warnings.push("这是高风险操作，请先确认没有依赖自定义网络配置");
    if (action.restartRequired) warnings.push("操作完成后需要重启 Windows 才能完全生效");
    if (action.id === "full-network-reset") warnings.push("虚拟网卡和 VPN/TUN 驱动也会被移除并重新安装");
    return { action, snapshotWillBeCreated: true, warnings };
  }

  async run(rawActionId: unknown): Promise<ActionResult> {
    const actionId = validateActionId(rawActionId);
    const action = getRepairAction(actionId);
    const snapshot = await this.snapshots.create(`执行前备份：${action.title}`);
    const snapshotDirectory = this.snapshots.resolveDirectory(snapshot.id);
    const script = getRepairScript(actionId, snapshotDirectory);
    try {
      const logs = action.requiresAdmin
        ? (await runElevatedPowerShell(script, path.join(this.dataDirectory, "jobs"))).logs
        : await runStandardPowerShell(script);
      const message = `${action.title}已完成${action.restartRequired ? "，请重启电脑" : ""}`;
      await this.audit.write({
        kind: "repair",
        title: action.title,
        detail: `${message} · 回滚快照 ${snapshot.id}`,
        success: true,
      });
      return {
        success: true,
        actionId,
        snapshotId: snapshot.id,
        message,
        logs,
        restartRequired: action.restartRequired,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit.write({
        kind: "error",
        title: `${action.title}失败`,
        detail: `${message} · 配置快照 ${snapshot.id} 已保留`,
        success: false,
      });
      return {
        success: false,
        actionId,
        snapshotId: snapshot.id,
        message,
        logs: [],
        restartRequired: false,
      };
    }
  }

  async restore(rawSnapshotId: unknown, rawScopes: unknown): Promise<RestoreResult> {
    if (typeof rawSnapshotId !== "string") throw new Error("快照编号无效");
    if (!Array.isArray(rawScopes) || rawScopes.length === 0) throw new Error("请至少选择一项还原内容");
    const scopes = [...new Set(rawScopes.map((scope) => {
      if (typeof scope !== "string" || !VALID_RESTORE_SCOPES.has(scope as RestoreScope)) {
        throw new Error("还原范围不在白名单中");
      }
      return scope as RestoreScope;
    }))];
    await this.snapshots.read(rawSnapshotId);
    const snapshotDirectory = this.snapshots.resolveDirectory(rawSnapshotId);
    const snapshotPath = escapePowerShellSingleQuoted(path.join(snapshotDirectory, "snapshot.json"));
    const hostsPath = escapePowerShellSingleQuoted(path.join(snapshotDirectory, "hosts"));
    const firewallPath = escapePowerShellSingleQuoted(path.join(snapshotDirectory, "firewall.wfw"));
    const blocks: string[] = [
      `$stored = Get-Content -LiteralPath '${snapshotPath}' -Raw | ConvertFrom-Json`,
    ];
    if (scopes.includes("proxy")) {
      blocks.push(`
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$proxy = $stored.raw.proxy
Set-ItemProperty -LiteralPath $key -Name ProxyEnable -Type DWord -Value $(if ($proxy.enabled) { 1 } else { 0 })
foreach ($pair in @(@('ProxyServer', [string]$proxy.server), @('ProxyOverride', [string]$proxy.override), @('AutoConfigURL', [string]$proxy.autoConfigUrl))) {
  if ($pair[1]) { Set-ItemProperty -LiteralPath $key -Name $pair[0] -Type String -Value $pair[1] }
  else { Remove-ItemProperty -LiteralPath $key -Name $pair[0] -ErrorAction SilentlyContinue }
}
Set-ItemProperty -LiteralPath $key -Name AutoDetect -Type DWord -Value $(if ($proxy.autoDetect) { 1 } else { 0 })
Add-Log '用户代理设置已还原'
`);
    }
    if (scopes.includes("dns")) {
      blocks.push(`
$restored = 0
foreach ($entry in @($stored.raw.dns | Where-Object { [int]$_.addressFamily -eq 2 })) {
  $adapter = Get-NetAdapter -InterfaceIndex ([int]$entry.interfaceIndex) -ErrorAction SilentlyContinue
  if (!$adapter) { continue }
  $servers = @($entry.serverAddresses | ForEach-Object { [string]$_ })
  if ($servers.Count -eq 0) { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses }
  else { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $servers }
  $restored++
}
Clear-DnsClientCache -ErrorAction SilentlyContinue
Add-Log ("已还原 {0} 个网卡的 DNS" -f $restored)
`);
    }
    if (scopes.includes("hosts")) {
      blocks.push(`
if (!(Test-Path -LiteralPath '${hostsPath}')) { throw '此快照没有可用的 Hosts 备份' }
Copy-Item -LiteralPath '${hostsPath}' -Destination (Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts') -Force
Clear-DnsClientCache -ErrorAction SilentlyContinue
Add-Log 'Hosts 文件已还原'
`);
    }
    if (scopes.includes("firewall")) {
      blocks.push(`
if (!(Test-Path -LiteralPath '${firewallPath}')) { throw '此快照没有防火墙策略文件' }
netsh advfirewall import '${firewallPath}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '防火墙策略还原失败' }
Add-Log '防火墙策略已还原'
`);
    }

    try {
      const result = await runElevatedPowerShell(blocks.join("\n"), path.join(this.dataDirectory, "jobs"));
      await this.audit.write({
        kind: "restore",
        title: "网络配置已还原",
        detail: `${rawSnapshotId} · ${scopes.join("、")}`,
        success: true,
      });
      return {
        success: true,
        snapshotId: rawSnapshotId,
        scopes,
        message: "所选网络配置已还原",
        logs: result.logs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.audit.write({
        kind: "error",
        title: "网络配置还原失败",
        detail: `${rawSnapshotId} · ${message}`,
        success: false,
      });
      return { success: false, snapshotId: rawSnapshotId, scopes, message, logs: [] };
    }
  }
}
