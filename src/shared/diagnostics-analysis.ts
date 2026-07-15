import type {
  ConnectivityResult,
  ListenerSnapshot,
  NetworkIssue,
  RawNetworkSnapshot,
  ScanCapture,
  ScanReport,
} from "./contracts";

const TUN_PATTERN = /tun|tap|wintun|clash|mihomo|xsus|sing-box|wireguard|openvpn|tailscale/i;

const asArray = <T>(value: T[] | T | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

export const normalizeSnapshot = (snapshot: RawNetworkSnapshot): RawNetworkSnapshot => ({
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

const listenerMatches = (listeners: ListenerSnapshot[], port: number): boolean =>
  listeners.some((listener) => listener.localPort === port);

export const analyzeSnapshot = (
  snapshot: RawNetworkSnapshot,
  connectivity: ConnectivityResult[],
): NetworkIssue[] => {
  const issues: NetworkIssue[] = [];
  const upAdapters = snapshot.adapters.filter((adapter) => adapter.status.toLowerCase() === "up");
  const tunnelAdapters = snapshot.adapters.filter((adapter) =>
    TUN_PATTERN.test(`${adapter.name} ${adapter.description}`),
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

export const computeScore = (issues: NetworkIssue[]): number => {
  const deduction = issues.reduce((total, issue) => {
    if (issue.id === "healthy") return total;
    return total + (issue.severity === "critical" ? 30 : issue.severity === "warning" ? 14 : 5);
  }, 0);
  return Math.max(0, 100 - deduction);
};

export const buildScanReport = (capture: ScanCapture): ScanReport => {
  const snapshot = normalizeSnapshot(capture.snapshot);
  const connectivity = asArray(capture.connectivity);
  const issues = analyzeSnapshot(snapshot, connectivity);
  const score = computeScore(issues);
  return {
    ...capture,
    snapshot,
    connectivity,
    issues,
    score,
    state: score < 45 ? "broken" : score < 80 ? "attention" : "healthy",
  };
};
