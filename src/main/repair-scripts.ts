import type { RepairActionId } from "../shared/contracts";
import { escapePowerShellSingleQuoted } from "./powershell";

const flushDns = `
Clear-DnsClientCache -ErrorAction SilentlyContinue
ipconfig /flushdns | Out-Null
Add-Log 'DNS 缓存已刷新'
`;

const removeOrphanTunRoutes = `
$pattern = 'tun|tap|wintun|clash|mihomo|xsus|sing-box|wireguard|openvpn|tailscale'
$removed = 0
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
  $route = $_
  $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
  $label = [string]$route.InterfaceAlias + ' ' + [string]$adapter.InterfaceDescription
  if ($label -match $pattern -and (!$adapter -or [string]$adapter.Status -ne 'Up')) {
    Remove-NetRoute -InterfaceIndex $route.InterfaceIndex -DestinationPrefix $route.DestinationPrefix -NextHop $route.NextHop -Confirm:$false -ErrorAction Stop
    $removed++
  }
}
Add-Log ("已清理 {0} 条断开隧道默认路由" -f $removed)
`;

const disableDeadProxy = `
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$settings = Get-ItemProperty -LiteralPath $key
$disabled = $false
if ([int]$settings.ProxyEnable -eq 1) {
  $matches = [regex]::Matches([string]$settings.ProxyServer, '(?:^|=)(?:https?://)?(?:127\\.0\\.0\\.1|localhost):(\\d+)')
  if ($matches.Count -gt 0) {
    $port = [int]$matches[0].Groups[1].Value
    $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if (!$listener) {
      Set-ItemProperty -LiteralPath $key -Name ProxyEnable -Type DWord -Value 0
      $disabled = $true
      Add-Log ("本地端口 {0} 无监听，已关闭失效系统代理" -f $port)
    }
  }
}
if (!$disabled) { Add-Log '系统代理未失效，未做更改' }
`;

const scripts: Record<RepairActionId, string> = {
  "quick-repair": `${flushDns}\n${disableDeadProxy}\n${removeOrphanTunRoutes}`,
  "flush-dns": flushDns,
  "renew-dhcp": `
ipconfig /release | Out-Null
Add-Log '已释放 DHCP 地址'
Start-Sleep -Seconds 1
ipconfig /renew | Out-Null
Add-Log '已重新获取 DHCP 地址'
${flushDns}
`,
  "dns-auto": `
$targets = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
if ($targets.Count -eq 0) { throw '没有找到已连接的物理网卡' }
foreach ($adapter in $targets) {
  Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses -ErrorAction Stop
  Add-Log ("{0} 已恢复自动 DNS" -f $adapter.Name)
}
${flushDns}
`,
  "disable-dead-proxy": disableDeadProxy,
  "reset-winhttp-proxy": `
netsh winhttp reset proxy | Out-Null
Add-Log 'WinHTTP 代理已重置为直连'
`,
  "sync-winhttp-proxy": `
netsh winhttp import proxy source=ie | Out-Null
Add-Log '已将当前用户代理同步到 WinHTTP'
`,
  "normalize-proxy-bypass": `
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$current = [string](Get-ItemPropertyValue -LiteralPath $key -Name ProxyOverride -ErrorAction SilentlyContinue)
$required = @('<local>', 'localhost', '127.0.0.1', '10.*', '172.16.*', '172.17.*', '172.18.*', '172.19.*', '172.20.*', '172.21.*', '172.22.*', '172.23.*', '172.24.*', '172.25.*', '172.26.*', '172.27.*', '172.28.*', '172.29.*', '172.30.*', '172.31.*', '192.168.*')
$all = @($current -split ';') + $required | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique
Set-ItemProperty -LiteralPath $key -Name ProxyOverride -Type String -Value ($all -join ';')
Add-Log '已保留现有规则并补全本机与局域网直连规则'
`,
  "remove-orphan-tun-routes": removeOrphanTunRoutes,
  "restart-active-adapters": `
$targets = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })
if ($targets.Count -eq 0) { throw '没有找到可重启的活动物理网卡' }
foreach ($adapter in $targets) {
  Disable-NetAdapter -InterfaceIndex $adapter.ifIndex -Confirm:$false -ErrorAction Stop
  Start-Sleep -Milliseconds 900
  Enable-NetAdapter -InterfaceIndex $adapter.ifIndex -Confirm:$false -ErrorAction Stop
  Add-Log ("已重启网卡 {0}" -f $adapter.Name)
}
`,
  "reset-winsock": `
netsh winsock reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Winsock 重置失败' }
Add-Log 'Winsock 已重置，建议重启电脑'
`,
  "reset-tcpip": `
netsh int ipv4 reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'IPv4 重置失败' }
netsh int ipv6 reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'IPv6 重置失败' }
${flushDns}
Add-Log 'TCP/IP 已重置，建议重启电脑'
`,
  "reset-firewall": "__DYNAMIC_FIREWALL__",
  "reset-hosts": `
$hostsPath = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'
$content = @('# Copyright (c) Microsoft Corporation.', '# Restored by Network First Aid', '', '127.0.0.1 localhost', '::1 localhost')
[IO.File]::WriteAllLines($hostsPath, $content, [Text.UTF8Encoding]::new($false))
Add-Log 'Hosts 已恢复为安全默认内容'
${flushDns}
`,
  "full-network-reset": "__DYNAMIC_FULL_RESET__",
};

export const getRepairScript = (actionId: RepairActionId, snapshotDirectory: string): string => {
  const script = scripts[actionId];
  const firewallPath = escapePowerShellSingleQuoted(`${snapshotDirectory}\\firewall.wfw`);
  if (script === "__DYNAMIC_FIREWALL__") {
    return `
netsh advfirewall export '${firewallPath}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '防火墙策略备份失败，已取消重置' }
Add-Log '防火墙策略已导出到本次快照'
netsh advfirewall reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw '防火墙重置失败' }
Add-Log 'Windows 防火墙已恢复默认规则'
`;
  }
  if (script === "__DYNAMIC_FULL_RESET__") {
    return `
netsh advfirewall export '${firewallPath}' | Out-Null
Add-Log '已尽力导出防火墙策略'
netcfg -d
if ($LASTEXITCODE -ne 0) { throw '网络组件重装失败' }
Add-Log '网络组件已移除并排队重装，请立即重启电脑'
`;
  }
  return script;
};
