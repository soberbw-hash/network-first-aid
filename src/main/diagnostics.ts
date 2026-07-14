import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";

import type {
  ConnectivityResult,
  ListenerSnapshot,
  NetworkIssue,
  RawNetworkSnapshot,
  ScanReport,
} from "../shared/contracts";
import { runPowerShell } from "./powershell";

const PROXY_PATTERN = /clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan/i;
const TUN_PATTERN = /tun|tap|wintun|clash|mihomo|xsus|sing-box|wireguard|openvpn|tailscale/i;

const DIAGNOSTIC_SCRIPT = String.raw`
$internetSettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    description = [string]$_.InterfaceDescription
    status = [string]$_.Status
    linkSpeed = [string]$_.LinkSpeed
    macAddress = [string]$_.MacAddress
    interfaceIndex = [int]$_.ifIndex
    hardwareInterface = [bool]$_.HardwareInterface
  }
})
$dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    addressFamily = [int]$_.AddressFamily
    serverAddresses = @($_.ServerAddresses | ForEach-Object { [string]$_ })
  }
})
$routeMapper = {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    destinationPrefix = [string]$_.DestinationPrefix
    nextHop = [string]$_.NextHop
    routeMetric = [int]$_.RouteMetric
    interfaceMetric = [int]$_.InterfaceMetric
    policyStore = [string]$_.PolicyStore
  }
}
$allRoutes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object $routeMapper)
$defaultRoutes = @($allRoutes | Where-Object { $_.destinationPrefix -eq '0.0.0.0/0' })
$proxyProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan'
} | ForEach-Object {
  $processPath = $null
  try { $processPath = [string]$_.Path } catch {}
  [ordered]@{ name = [string]$_.ProcessName; id = [int]$_.Id; path = $processPath }
})
$proxyServices = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan' -or
  $_.DisplayName -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan'
} | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; status = [string]$_.Status; startType = [string]$_.StartType }
})
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort; owningProcess = [int]$_.OwningProcess }
})
$ipConfigurations = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    ipv4Address = @($_.IPv4Address | ForEach-Object { [string]$_.IPAddress })
    ipv4DefaultGateway = @($_.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop })
    netProfileName = if ($_.NetProfile) { [string]$_.NetProfile.Name } else { '' }
  }
})
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostsLines = @()
$hostsHash = ''
if (Test-Path -LiteralPath $hostsPath) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($hostsPath)
  try { $hostsHash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
  finally { $stream.Dispose(); $sha256.Dispose() }
  $hostsLines = @(Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue | Where-Object {
    $line = $_.Trim()
    $line -and -not $line.StartsWith('#')
  } | ForEach-Object { [string]$_ })
}
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    interfaceAlias = [string]$_.InterfaceAlias
    networkCategory = [string]$_.NetworkCategory
    ipv4Connectivity = [string]$_.IPv4Connectivity
  }
})
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
[ordered]@{
  capturedAt = [DateTime]::UtcNow.ToString('o')
  computerName = [string]$env:COMPUTERNAME
  windowsVersion = if ($os) { [string]($os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber) } else { [Environment]::OSVersion.VersionString }
  proxy = [ordered]@{
    enabled = ([int]$internetSettings.ProxyEnable -eq 1)
    server = [string]$internetSettings.ProxyServer
    override = [string]$internetSettings.ProxyOverride
    autoConfigUrl = [string]$internetSettings.AutoConfigURL
    autoDetect = ([int]$internetSettings.AutoDetect -eq 1)
  }
  winHttpProxy = [string](netsh winhttp show proxy | Out-String).Trim()
  adapters = $adapters
  dns = $dns
  defaultRoutes = $defaultRoutes
  allRoutes = $allRoutes
  proxyProcesses = $proxyProcesses
  proxyServices = $proxyServices
  listeners = $listeners
  ipConfigurations = $ipConfigurations
  hostsHash = $hostsHash
  hostsEntries = $hostsLines
  networkProfiles = $profiles
} | ConvertTo-Json -Depth 12 -Compress
`;

const asArray = <T>(value: T[] | T | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const normalizeSnapshot = (snapshot: RawNetworkSnapshot): RawNetworkSnapshot => ({
  ...snapshot,
  adapters: asArray(snapshot.adapters),
  dns: asArray(snapshot.dns).map((entry) => ({
    ...entry,
    serverAddresses: asArray(entry.serverAddresses),
  })),
  defaultRoutes: asArray(snapshot.defaultRoutes),
  allRoutes: asArray(snapshot.allRoutes),
  proxyProcesses: asArray(snapshot.proxyProcesses),
  proxyServices: asArray(snapshot.proxyServices),
  listeners: asArray(snapshot.listeners),
  ipConfigurations: asArray(snapshot.ipConfigurations).map((entry) => ({
    ...entry,
    ipv4Address: asArray(entry.ipv4Address),
    ipv4DefaultGateway: asArray(entry.ipv4DefaultGateway),
  })),
  hostsEntries: asArray(snapshot.hostsEntries),
  networkProfiles: asArray(snapshot.networkProfiles),
});

const parseProxyEndpoint = (server: string): { host: string; port: number } | undefined => {
  const candidate = server
    .split(";")
    .map((part) => part.trim())
    .find((part) => /(?:^|=)(?:https?:\/\/)?(?:127\.0\.0\.1|localhost):\d+$/i.test(part));
  if (!candidate) return undefined;
  const endpoint = (candidate.includes("=") ? candidate.slice(candidate.indexOf("=") + 1) : candidate).replace(
    /^https?:\/\//i,
    "",
  );
  const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(endpoint);
  if (!match?.[1] || !match[2]) return undefined;
  return { host: match[1], port: Number(match[2]) };
};

const testTcp = async (name: string, host: string, port: number): Promise<ConnectivityResult> => {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean, detail: string) => {
      socket.destroy();
      resolve({
        name,
        target: `${host}:${port}`,
        ok,
        latencyMs: Math.round(performance.now() - startedAt),
        detail,
      });
    };
    socket.setTimeout(2_500);
    socket.once("connect", () => finish(true, "端口正在监听"));
    socket.once("timeout", () => finish(false, "连接超时"));
    socket.once("error", (error) => finish(false, error.message));
  });
};

const testHttpProxyTunnel = async (host: string, port: number): Promise<ConnectivityResult> => {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let finished = false;
    let responseHead = "";
    const finish = (ok: boolean, detail: string) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({
        name: "代理出口（ChatGPT）",
        target: "chatgpt.com:443",
        ok,
        latencyMs: Math.round(performance.now() - startedAt),
        detail,
      });
    };
    socket.setTimeout(6_500);
    socket.once("timeout", () => finish(false, "代理 CONNECT 超时"));
    socket.once("error", (error) => finish(false, error.message));
    socket.once("connect", () => {
      socket.write(
        "CONNECT chatgpt.com:443 HTTP/1.1\r\nHost: chatgpt.com:443\r\nProxy-Connection: keep-alive\r\n\r\n",
      );
    });
    const onData = (chunk: Buffer) => {
      responseHead += chunk.toString("latin1");
      if (!responseHead.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(responseHead)?.[1];
      if (status !== "200") {
        finish(false, status ? `代理返回 HTTP ${status}` : "代理返回了无效的 CONNECT 响应");
        return;
      }
      socket.setTimeout(0);
      const secureSocket = tls.connect({ socket, servername: "chatgpt.com", rejectUnauthorized: true });
      secureSocket.setTimeout(6_500);
      secureSocket.once("secureConnect", () => {
        const protocol = secureSocket.getProtocol() ?? "TLS";
        secureSocket.destroy();
        finish(true, `CONNECT 与 ${protocol} 握手成功`);
      });
      secureSocket.once("timeout", () => finish(false, "连接 ChatGPT 的 TLS 握手超时"));
      secureSocket.once("error", (error) => finish(false, `TLS 失败：${error.message}`));
    };
    socket.on("data", onData);
  });
};

const testHttp = async (name: string, target: string): Promise<ConnectivityResult> => {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "NetworkFirstAid/0.1" },
    });
    return {
      name,
      target,
      ok: response.status > 0 && response.status < 500,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      name,
      target,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const listenerMatches = (listeners: ListenerSnapshot[], port: number): boolean =>
  listeners.some((listener) => listener.localPort === port);

export const analyzeSnapshot = (
  snapshot: RawNetworkSnapshot,
  connectivity: ConnectivityResult[],
): NetworkIssue[] => {
  const issues: NetworkIssue[] = [];
  const upAdapters = snapshot.adapters.filter((adapter) => adapter.status.toLowerCase() === "up");
  const tunnelAdapters = snapshot.adapters.filter(
    (adapter) => TUN_PATTERN.test(`${adapter.name} ${adapter.description}`),
  );
  const activeTunnelAdapters = tunnelAdapters.filter((adapter) => adapter.status.toLowerCase() === "up");
  const distinctProxyFamilies = new Set(
    snapshot.proxyProcesses.map((process) => {
      const name = process.name.toLowerCase().replace(/[-_ ]/g, "");
      if (/clash|mihomo/.test(name)) return "clash";
      if (/xsus/.test(name)) return "xsus";
      if (/singbox/.test(name)) return "singbox";
      if (/v2ray|xray/.test(name)) return "xray";
      return name;
    }),
  );
  const proxyEndpoint = parseProxyEndpoint(snapshot.proxy.server);

  if (upAdapters.length === 0) {
    issues.push({
      id: "no-active-adapter",
      severity: "critical",
      title: "没有已连接的网卡",
      summary: "Windows 当前没有状态为 Up 的网络适配器。",
      evidence: snapshot.adapters.map((adapter) => `${adapter.name}: ${adapter.status}`),
      actionId: "restart-active-adapters",
    });
  }

  if (snapshot.defaultRoutes.length === 0) {
    issues.push({
      id: "no-default-route",
      severity: "critical",
      title: "缺少默认路由",
      summary: "电脑不知道外网流量应该发往哪个网关。",
      evidence: ["未找到 0.0.0.0/0 路由"],
      actionId: "renew-dhcp",
    });
  }

  if (snapshot.proxy.enabled && proxyEndpoint && !listenerMatches(snapshot.listeners, proxyEndpoint.port)) {
    issues.push({
      id: "dead-local-proxy",
      severity: "critical",
      title: "系统代理指向失效端口",
      summary: "Windows 仍把流量送给本机代理，但这个端口没有程序监听。",
      evidence: [`代理：${snapshot.proxy.server}`, `端口 ${proxyEndpoint.port} 未监听`],
      actionId: "disable-dead-proxy",
    });
  }

  if (distinctProxyFamilies.size > 1) {
    issues.push({
      id: "multiple-proxy-cores",
      severity: "warning",
      title: "发现多个代理内核同时存在",
      summary: "多个代理程序可能争用系统代理、DNS 或 TUN 默认路由。",
      evidence: snapshot.proxyProcesses.map((process) => `${process.name} (PID ${process.id})`),
      actionId: "quick-repair",
    });
  }

  if (activeTunnelAdapters.length > 1 || (activeTunnelAdapters.length > 0 && distinctProxyFamilies.size > 1)) {
    issues.push({
      id: "tun-proxy-conflict",
      severity: "warning",
      title: "代理与 TUN 可能互相抢路由",
      summary: "检测到活动隧道与多个代理内核，连接时好时坏通常由路由所有权切换造成。",
      evidence: activeTunnelAdapters.map((adapter) => `${adapter.name}: ${adapter.description}`),
      actionId: "remove-orphan-tun-routes",
    });
  }

  const orphanTunRoutes = snapshot.defaultRoutes.filter((route) => {
    if (!TUN_PATTERN.test(route.interfaceAlias)) return false;
    const adapter = snapshot.adapters.find((item) => item.interfaceIndex === route.interfaceIndex);
    return !adapter || adapter.status.toLowerCase() !== "up";
  });
  if (orphanTunRoutes.length > 0) {
    issues.push({
      id: "orphan-tun-route",
      severity: "warning",
      title: "断开的 TUN 仍保留默认路由",
      summary: "部分流量可能被送入已经关闭的代理隧道。",
      evidence: orphanTunRoutes.map(
        (route) => `${route.interfaceAlias} → ${route.nextHop}，跃点 ${route.routeMetric + route.interfaceMetric}`,
      ),
      actionId: "remove-orphan-tun-routes",
    });
  }

  const activePhysical = upAdapters.filter((adapter) => adapter.hardwareInterface);
  const activeIndexes = new Set(activePhysical.map((adapter) => adapter.interfaceIndex));
  const dnsForActive = snapshot.dns.filter(
    (entry) => entry.addressFamily === 2 && activeIndexes.has(entry.interfaceIndex),
  );
  if (activePhysical.length > 0 && dnsForActive.every((entry) => entry.serverAddresses.length === 0)) {
    issues.push({
      id: "missing-dns",
      severity: "critical",
      title: "活动网卡没有 DNS",
      summary: "能访问 IP 但域名会一直加载或直接失败。",
      evidence: activePhysical.map((adapter) => adapter.name),
      actionId: "dns-auto",
    });
  }

  const suspiciousStaticDns = dnsForActive.flatMap((entry) =>
    entry.serverAddresses.filter((address) => /^4\.2\.2\.[12]$/.test(address)),
  );
  if (suspiciousStaticDns.length > 0) {
    issues.push({
      id: "legacy-static-dns",
      severity: "warning",
      title: "网卡仍使用旧的静态 DNS",
      summary: "这些 DNS 在当前网络可能绕路或响应很慢，与你关代理后变慢的现象一致。",
      evidence: suspiciousStaticDns,
      actionId: "dns-auto",
    });
  }

  if (snapshot.hostsEntries.some((line) => /chatgpt|openai|github|twitter|x\.com/i.test(line))) {
    issues.push({
      id: "hosts-sensitive-domain",
      severity: "warning",
      title: "Hosts 覆盖了常用网络服务",
      summary: "静态 Hosts 记录可能让目标站点连接到过期或错误地址。",
      evidence: snapshot.hostsEntries.filter((line) => /chatgpt|openai|github|twitter|x\.com/i.test(line)),
      actionId: "reset-hosts",
    });
  }

  const directTests = connectivity.filter((test) => !test.name.includes("代理"));
  if (directTests.length > 0 && directTests.every((test) => !test.ok)) {
    issues.push({
      id: "direct-connectivity-failed",
      severity: "critical",
      title: "直连探测全部失败",
      summary: "问题可能位于 DNS、默认路由、网卡或防火墙，而不是某一个网站。",
      evidence: directTests.map((test) => `${test.name}: ${test.detail}`),
      actionId: "quick-repair",
    });
  }

  const slowTest = directTests.find((test) => test.ok && test.latencyMs > 2_500);
  if (slowTest) {
    issues.push({
      id: "slow-direct-network",
      severity: "notice",
      title: "直连可用但响应偏慢",
      summary: "本地网络没有完全断开，但 DNS、上游链路或路由可能存在抖动。",
      evidence: [`${slowTest.name}: ${slowTest.latencyMs} ms`],
      actionId: "flush-dns",
    });
  }

  const localProxyTest = connectivity.find((test) => test.name === "本地代理端口");
  const proxyEgressTest = connectivity.find((test) => test.name === "代理出口（ChatGPT）");
  if (localProxyTest?.ok && proxyEgressTest && !proxyEgressTest.ok) {
    issues.push({
      id: "proxy-egress-failed",
      severity: "critical",
      title: "本地代理正常，但节点出口失败",
      summary: "代理软件端口在监听，但它没有成功连到 ChatGPT；电脑显示 timeout 而手机可用时，通常要检查电脑节点、协议或 TUN 路径。",
      evidence: [proxyEgressTest.detail, `本地端口响应 ${localProxyTest.latencyMs} ms`],
    });
  }

  if (issues.length === 0) {
    issues.push({
      id: "healthy",
      severity: "notice",
      title: "暂未发现明显配置故障",
      summary: "当前代理端口、活动网卡、默认路由和 DNS 基本正常。",
      evidence: ["建议在问题再次出现时立即运行检测，以捕获瞬时状态"],
    });
  }
  return issues;
};

const computeScore = (issues: NetworkIssue[]): number => {
  const deduction = issues.reduce((total, issue) => {
    if (issue.id === "healthy") return total;
    return total + (issue.severity === "critical" ? 30 : issue.severity === "warning" ? 14 : 5);
  }, 0);
  return Math.max(0, 100 - deduction);
};

export class DiagnosticsService {
  async captureRawSnapshot(): Promise<RawNetworkSnapshot> {
    const output = await runPowerShell(DIAGNOSTIC_SCRIPT, 60_000);
    if (!output) throw new Error("Windows 没有返回网络配置");
    return normalizeSnapshot(JSON.parse(output) as RawNetworkSnapshot);
  }

  async scan(): Promise<ScanReport> {
    const startedAt = performance.now();
    const snapshot = await this.captureRawSnapshot();
    const tests: Array<Promise<ConnectivityResult>> = [
      testHttp("国内直连", "https://www.baidu.com/"),
      testHttp("Windows 联网探测", "http://www.msftconnecttest.com/connecttest.txt"),
    ];
    const endpoint = parseProxyEndpoint(snapshot.proxy.server);
    if (snapshot.proxy.enabled && endpoint) {
      tests.push(testTcp("本地代理端口", endpoint.host, endpoint.port));
      tests.push(testHttpProxyTunnel(endpoint.host, endpoint.port));
    }
    const connectivity = await Promise.all(tests);
    const issues = analyzeSnapshot(snapshot, connectivity);
    const score = computeScore(issues);
    return {
      generatedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      score,
      state: score < 45 ? "broken" : score < 80 ? "attention" : "healthy",
      issues,
      snapshot,
      connectivity,
    };
  }
}

export const diagnosticPatterns = { PROXY_PATTERN, TUN_PATTERN };
