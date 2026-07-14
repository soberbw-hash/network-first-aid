export type Severity = "critical" | "warning" | "notice";
export type RiskLevel = "low" | "medium" | "high";

export interface AdapterSnapshot {
  name: string;
  description: string;
  status: string;
  linkSpeed: string;
  macAddress: string;
  interfaceIndex: number;
  hardwareInterface: boolean;
}

export interface DnsSnapshot {
  interfaceAlias: string;
  interfaceIndex: number;
  addressFamily: number;
  serverAddresses: string[];
}

export interface RouteSnapshot {
  interfaceAlias: string;
  interfaceIndex: number;
  destinationPrefix: string;
  nextHop: string;
  routeMetric: number;
  interfaceMetric: number;
  policyStore: string;
}

export interface ProxyProcess {
  name: string;
  id: number;
  path?: string;
}

export interface ServiceSnapshot {
  name: string;
  displayName: string;
  status: string;
  startType: string;
}

export interface ListenerSnapshot {
  localAddress: string;
  localPort: number;
  owningProcess: number;
}

export interface RawNetworkSnapshot {
  capturedAt: string;
  computerName: string;
  windowsVersion: string;
  proxy: {
    enabled: boolean;
    server: string;
    override: string;
    autoConfigUrl: string;
    autoDetect: boolean;
  };
  winHttpProxy: string;
  adapters: AdapterSnapshot[];
  dns: DnsSnapshot[];
  defaultRoutes: RouteSnapshot[];
  allRoutes: RouteSnapshot[];
  proxyProcesses: ProxyProcess[];
  proxyServices: ServiceSnapshot[];
  listeners: ListenerSnapshot[];
  ipConfigurations: Array<{
    interfaceAlias: string;
    interfaceIndex: number;
    ipv4Address: string[];
    ipv4DefaultGateway: string[];
    netProfileName: string;
  }>;
  hostsHash: string;
  hostsEntries: string[];
  networkProfiles: Array<{
    name: string;
    interfaceAlias: string;
    networkCategory: string;
    ipv4Connectivity: string;
  }>;
}

export interface ConnectivityResult {
  name: string;
  target: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export interface NetworkIssue {
  id: string;
  severity: Severity;
  title: string;
  summary: string;
  evidence: string[];
  actionId?: RepairActionId;
}

export interface ScanReport {
  generatedAt: string;
  durationMs: number;
  score: number;
  state: "healthy" | "attention" | "broken";
  issues: NetworkIssue[];
  snapshot: RawNetworkSnapshot;
  connectivity: ConnectivityResult[];
}

export type RepairActionId =
  | "quick-repair"
  | "flush-dns"
  | "renew-dhcp"
  | "dns-auto"
  | "disable-dead-proxy"
  | "reset-winhttp-proxy"
  | "sync-winhttp-proxy"
  | "normalize-proxy-bypass"
  | "remove-orphan-tun-routes"
  | "restart-active-adapters"
  | "reset-winsock"
  | "reset-tcpip"
  | "reset-firewall"
  | "reset-hosts"
  | "full-network-reset";

export interface RepairActionDefinition {
  id: RepairActionId;
  title: string;
  description: string;
  risk: RiskLevel;
  requiresAdmin: boolean;
  restartRequired: boolean;
  recommendedFor: string;
  steps: string[];
}

export interface ActionPreview {
  action: RepairActionDefinition;
  snapshotWillBeCreated: boolean;
  warnings: string[];
}

export interface ActionResult {
  success: boolean;
  actionId: RepairActionId;
  snapshotId?: string;
  message: string;
  logs: string[];
  restartRequired: boolean;
}

export interface SnapshotSummary {
  id: string;
  createdAt: string;
  reason: string;
  computerName: string;
  sizeBytes: number;
}

export type RestoreScope = "proxy" | "dns" | "hosts" | "firewall";

export interface RestoreResult {
  success: boolean;
  snapshotId: string;
  scopes: RestoreScope[];
  message: string;
  logs: string[];
}

export interface AuditEntry {
  timestamp: string;
  kind: "scan" | "backup" | "repair" | "restore" | "error";
  title: string;
  detail: string;
  success: boolean;
}

export interface AppInfo {
  version: string;
  platform: string;
  isAdmin: boolean;
  dataDirectory: string;
}

export interface NetworkRepairApi {
  app: {
    info(): Promise<AppInfo>;
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    openDataDirectory(): Promise<void>;
  };
  diagnostics: {
    scan(): Promise<ScanReport>;
  };
  repairs: {
    list(): Promise<RepairActionDefinition[]>;
    preview(actionId: RepairActionId): Promise<ActionPreview>;
    run(actionId: RepairActionId): Promise<ActionResult>;
  };
  snapshots: {
    list(): Promise<SnapshotSummary[]>;
    create(reason?: string): Promise<SnapshotSummary>;
    restore(snapshotId: string, scopes: RestoreScope[]): Promise<RestoreResult>;
    remove(snapshotId: string): Promise<void>;
  };
  audit: {
    list(): Promise<AuditEntry[]>;
  };
}

export const IPC = {
  appInfo: "netfix:app-info",
  minimize: "netfix:minimize",
  toggleMaximize: "netfix:toggle-maximize",
  close: "netfix:close",
  openDataDirectory: "netfix:open-data-directory",
  scan: "netfix:scan",
  repairList: "netfix:repair-list",
  repairPreview: "netfix:repair-preview",
  repairRun: "netfix:repair-run",
  snapshotList: "netfix:snapshot-list",
  snapshotCreate: "netfix:snapshot-create",
  snapshotRestore: "netfix:snapshot-restore",
  snapshotRemove: "netfix:snapshot-remove",
  auditList: "netfix:audit-list",
} as const;
