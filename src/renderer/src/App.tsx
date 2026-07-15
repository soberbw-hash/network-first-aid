import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Bandage,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleGauge,
  Clock3,
  Coffee,
  DatabaseBackup,
  Download,
  EthernetPort,
  FileClock,
  FolderOpen,
  History,
  HeartHandshake,
  Info,
  LoaderCircle,
  Maximize2,
  Minus,
  Network,
  Power,
  RefreshCcw,
  RotateCcw,
  Router,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wifi,
  Wrench,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ActionPreview,
  ActionResult,
  AppInfo,
  AuditEntry,
  NetworkIssue,
  RepairActionDefinition,
  RepairActionId,
  RestoreScope,
  ScanReport,
  SnapshotSummary,
  UpdateCheckResult,
} from "../../shared/contracts";
import { networkRepair } from "./api";

type Page = "overview" | "diagnostics" | "repairs" | "snapshots" | "history";

const navigation: Array<{ id: Page; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "总览", icon: CircleGauge },
  { id: "diagnostics", label: "网络体检", icon: Activity },
  { id: "repairs", label: "修复工具", icon: Wrench },
  { id: "snapshots", label: "备份与还原", icon: DatabaseBackup },
  { id: "history", label: "操作记录", icon: History },
];

const severityText = { critical: "需要处理", warning: "建议处理", notice: "提示" } as const;
const riskText = { low: "低风险", medium: "中风险", high: "高风险" } as const;
const scopeOptions: Array<{ id: RestoreScope; label: string; detail: string }> = [
  { id: "proxy", label: "代理设置", detail: "系统代理、自动配置与绕过规则" },
  { id: "dns", label: "DNS 设置", detail: "每张仍存在的网卡 DNS" },
  { id: "hosts", label: "Hosts 文件", detail: "快照中保存的完整文件" },
  { id: "firewall", label: "防火墙策略", detail: "仅部分高风险操作前会导出" },
];

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, "") : String(error);

export function App() {
  const [page, setPage] = useState<Page>("overview");
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [report, setReport] = useState<ScanReport>();
  const [actions, setActions] = useState<RepairActionDefinition[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ActionPreview>();
  const [confirmed, setConfirmed] = useState(false);
  const [restoreSnapshot, setRestoreSnapshot] = useState<SnapshotSummary>();
  const [restoreScopes, setRestoreScopes] = useState<RestoreScope[]>(["proxy", "dns"]);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string }>();
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult>();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  const refreshSecondaryData = useCallback(async () => {
    const [nextSnapshots, nextAudit] = await Promise.all([
      networkRepair.snapshots.list(),
      networkRepair.audit.list(),
    ]);
    setSnapshots(nextSnapshots);
    setAudit(nextAudit);
  }, []);

  useEffect(() => {
    void Promise.all([
      networkRepair.app.info().then(setAppInfo),
      networkRepair.repairs.list().then(setActions),
      refreshSecondaryData(),
    ]).catch((error) => setNotice({ kind: "error", text: errorMessage(error) }));
  }, [refreshSecondaryData]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const nextReport = await networkRepair.diagnostics.scan();
      setReport(nextReport);
      await refreshSecondaryData();
      setNotice({ kind: "success", text: `体检完成，网络健康度 ${nextReport.score} 分` });
    } catch (error) {
      setNotice({ kind: "error", text: `检测失败：${errorMessage(error)}` });
    } finally {
      setScanning(false);
    }
  }, [refreshSecondaryData]);

  const openPreview = useCallback(async (actionId: RepairActionId) => {
    try {
      setConfirmed(false);
      setPreview(await networkRepair.repairs.preview(actionId));
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  }, []);

  const runAction = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result: ActionResult = await networkRepair.repairs.run(preview.action.id);
      setPreview(undefined);
      setNotice({ kind: result.success ? "success" : "error", text: result.message });
      await refreshSecondaryData();
      if (result.success) await runScan();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [preview, refreshSecondaryData, runScan]);

  const createSnapshot = useCallback(async () => {
    setBusy(true);
    try {
      const snapshot = await networkRepair.snapshots.create("手动备份");
      await refreshSecondaryData();
      setNotice({ kind: "success", text: `快照 ${snapshot.id} 已创建` });
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [refreshSecondaryData]);

  const runRestore = useCallback(async () => {
    if (!restoreSnapshot || restoreScopes.length === 0) return;
    setBusy(true);
    try {
      const result = await networkRepair.snapshots.restore(restoreSnapshot.id, restoreScopes);
      setRestoreSnapshot(undefined);
      setNotice({ kind: result.success ? "success" : "error", text: result.message });
      await refreshSecondaryData();
      if (result.success) await runScan();
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, [refreshSecondaryData, restoreScopes, restoreSnapshot, runScan]);

  const deleteSnapshot = useCallback(
    async (snapshot: SnapshotSummary) => {
      if (!window.confirm(`确定删除快照 ${snapshot.id}？此操作无法撤销。`)) return;
      try {
        await networkRepair.snapshots.remove(snapshot.id);
        await refreshSecondaryData();
        setNotice({ kind: "success", text: "快照已删除" });
      } catch (error) {
        setNotice({ kind: "error", text: errorMessage(error) });
      }
    },
    [refreshSecondaryData],
  );

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const result = await networkRepair.app.checkForUpdates();
      setUpdateResult(result);
      if (result.updateAvailable) {
        setUpdateOpen(true);
      } else {
        setNotice({ kind: "success", text: `当前已是最新版本 v${result.currentVersion}` });
      }
    } catch (error) {
      setNotice({ kind: "error", text: `检查更新失败：${errorMessage(error)}` });
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const openLatestRelease = useCallback(async () => {
    try {
      await networkRepair.app.openLatestRelease();
      setUpdateOpen(false);
    } catch (error) {
      setNotice({ kind: "error", text: `打开下载页面失败：${errorMessage(error)}` });
    }
  }, []);

  const recommendedActionIds = useMemo(
    () => new Set(report?.issues.map((issue) => issue.actionId).filter(Boolean) ?? []),
    [report],
  );

  const renderIssue = (issue: NetworkIssue) => {
    const Icon = issue.severity === "critical" ? XCircle : issue.severity === "warning" ? AlertTriangle : Info;
    return (
      <article className={`issue-card issue-${issue.severity}`} key={issue.id}>
        <span className="issue-icon"><Icon size={19} /></span>
        <div className="issue-copy">
          <div className="issue-title-row">
            <h3>{issue.title}</h3>
            <span>{severityText[issue.severity]}</span>
          </div>
          <p>{issue.summary}</p>
          {issue.evidence.length > 0 && issue.id !== "healthy" && (
            <details>
              <summary>查看依据</summary>
              <ul>{issue.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          )}
        </div>
        {issue.actionId && (
          <button className="compact-button" onClick={() => void openPreview(issue.actionId!)}>
            修复 <ChevronRight size={15} />
          </button>
        )}
      </article>
    );
  };

  const renderOverview = () => {
    const statusLabel = !report
      ? "准备为网络体检"
      : report.state === "healthy"
        ? "网络状态良好"
        : report.state === "attention"
          ? "网络需要关注"
          : "网络存在异常";
    const score = report?.score ?? 0;
    const activeAdapters = report?.snapshot.adapters.filter((adapter) => adapter.status.toLowerCase() === "up") ?? [];
    const proxy = report?.snapshot.proxy;
    const primaryDns = report?.snapshot.dns.find((item) => item.addressFamily === 2 && item.serverAddresses.length);
    const primaryRoute = report?.snapshot.defaultRoutes[0];
    const issueCount = report?.issues.filter((item) => item.id !== "healthy").length ?? 0;
    const checks = [
      {
        icon: Router,
        label: "本地代理链路",
        value: !report ? "等待检测" : proxy?.enabled ? "已接管" : "当前直连",
        ok: Boolean(report),
      },
      {
        icon: Network,
        label: "DNS 解析服务",
        value: !report ? "等待检测" : primaryDns?.serverAddresses[0] ?? "未配置",
        ok: Boolean(primaryDns),
      },
      {
        icon: Wifi,
        label: "默认路由出口",
        value: !report ? "等待检测" : primaryRoute?.nextHop ?? "未发现",
        ok: Boolean(primaryRoute),
      },
      {
        icon: ShieldCheck,
        label: "回滚保护",
        value: snapshots.length ? `${snapshots.length} 个快照` : "可随时创建",
        ok: snapshots.length > 0,
      },
    ];
    return (
      <>
        <section className={`overview-hero state-${report?.state ?? "idle"}`}>
          <div className="network-aura" aria-hidden="true"><Activity size={164} strokeWidth={0.7} /></div>
          <div className="overview-copy">
            <span className="eyebrow"><span className="live-dot" /> 网络状态中心</span>
            <h1>{report?.state === "healthy" ? <>网络状态<span>良好</span></> : statusLabel}</h1>
            <p>{report
              ? `${activeAdapters.length} 张活动网卡 · 最近体检耗时 ${(report.durationMs / 1000).toFixed(1)} 秒`
              : "先做一次完整体检，确认代理、TUN、DNS 与系统路由是否互相冲突。"}</p>
            <div className="overview-tags">
              <span><ShieldCheck size={15} /> 修复前自动备份</span>
              <span><Clock3 size={15} /> 全程可回滚</span>
            </div>
          </div>

          <aside className="diagnosis-panel">
            <div className="diagnosis-head">
              <div className="score-display"><strong>{report ? score : "?"}</strong><span>分</span><small>{report ? (issueCount ? `${issueCount} 项待关注` : "当前很健康") : "健康度"}</small></div>
              <button className="primary-button scan-button" onClick={() => void runScan()} disabled={scanning}>
                {scanning ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
                {scanning ? "正在体检…" : report ? "再次体检" : "立即体检"}
              </button>
            </div>
            <div className="check-list">
              {checks.map((check, index) => <div className="check-row" style={{ "--delay": `${index * 55}ms` } as React.CSSProperties} key={check.label}>
                <span className={`check-icon ${!report ? "pending" : check.ok ? "ok" : "warn"}`}><check.icon size={17} /></span>
                <span>{check.label}</span>
                <strong>{check.value}</strong>
              </div>)}
            </div>
          </aside>

          <div className="status-rail">
            <div><span className="rail-icon"><EthernetPort size={18} /></span><p><small>活动网卡</small><strong>{report ? activeAdapters.length : "未测"}</strong><em>{activeAdapters[0]?.name ?? "尚未检测"}</em></p></div>
            <div><span className="rail-icon"><Router size={18} /></span><p><small>系统代理</small><strong>{report ? (proxy?.enabled ? "已开启" : "已关闭") : "未测"}</strong><em>{proxy?.enabled ? proxy.server : "当前直连"}</em></p></div>
            <div><span className="rail-icon"><Network size={18} /></span><p><small>默认路由</small><strong>{report ? report.snapshot.defaultRoutes.length : "未测"}</strong><em>{primaryRoute?.nextHop ?? "尚未检测"}</em></p></div>
            <div><span className="rail-icon"><DatabaseBackup size={18} /></span><p><small>本地备份</small><strong>{snapshots.length}</strong><em>{snapshots[0] ? formatTime(snapshots[0].createdAt) : "还没有快照"}</em></p><button className="rail-action" title="创建快照" onClick={() => void createSnapshot()} disabled={busy}><ChevronRight size={16} /></button></div>
          </div>
        </section>

        <section className="section-block overview-findings">
          <div className="section-heading"><div><span className="eyebrow">诊断结果</span><h2>{report ? (issueCount ? `发现 ${issueCount} 个值得关注的项目` : "本轮检查没有发现明显问题") : "还没有诊断数据"}</h2></div>{report && <button className="text-button" onClick={() => setPage("diagnostics")}>查看完整报告 <ChevronRight size={16} /></button>}</div>
          <div className="issues-list">
            {report ? report.issues.slice(0, 4).map(renderIssue) : (
              <div className="empty-state"><Wifi size={30} /><h3>先让软件看一眼当前网络</h3><p>体检只读取配置，不会更改任何内容，也不需要管理员权限。</p></div>
            )}
          </div>
        </section>
      </>
    );
  };

  const renderDiagnostics = () => (
    <>
      <section className="page-heading"><div><span className="eyebrow">只读检测</span><h1>网络体检</h1><p>一次收集网卡、DNS、代理、路由、TUN、服务、端口与连通性。</p></div><button className="primary-button" onClick={() => void runScan()} disabled={scanning}>{scanning ? <LoaderCircle className="spin" size={18} /> : <RefreshCcw size={18} />}{scanning ? "检测中…" : "重新检测"}</button></section>
      {!report ? <div className="large-empty"><Activity size={36} /><h2>尚未运行体检</h2><p>检测不会修改网络设置。</p><button className="primary-button" onClick={() => void runScan()}>开始体检</button></div> : (
        <>
          <section className="diagnostic-summary"><div className={`mini-score state-${report.state}`}><strong>{report.score}</strong><span>健康度</span></div><div><h2>{report.state === "healthy" ? "当前配置整体正常" : "检测到需要关注的网络配置"}</h2><p>{formatTime(report.generatedAt)} · 用时 {(report.durationMs / 1000).toFixed(1)} 秒 · {report.snapshot.windowsVersion}</p></div></section>
          <section className="connectivity-grid">{report.connectivity.map((test) => <article key={test.name}><span className={test.ok ? "test-ok" : "test-fail"}>{test.ok ? <Check size={16} /> : <X size={16} />}</span><div><h3>{test.name}</h3><p>{test.target}</p></div><strong>{test.ok ? `${test.latencyMs} ms` : "失败"}</strong></article>)}</section>
          <section className="section-block"><div className="section-heading"><div><span className="eyebrow">配置分析</span><h2>问题与建议</h2></div></div><div className="issues-list">{report.issues.map(renderIssue)}</div></section>
          <section className="detail-grid">
            <article><h3><EthernetPort size={18} /> 网卡</h3>{report.snapshot.adapters.map((item) => <div className="detail-row" key={item.interfaceIndex}><span>{item.name}</span><b className={item.status.toLowerCase() === "up" ? "positive" : "muted"}>{item.status}</b></div>)}</article>
            <article><h3><Router size={18} /> 代理进程</h3>{report.snapshot.proxyProcesses.length ? report.snapshot.proxyProcesses.map((item) => <div className="detail-row" key={item.id}><span>{item.name}</span><b>PID {item.id}</b></div>) : <p className="muted">未发现常见代理进程</p>}</article>
            <article><h3><Network size={18} /> IPv4 DNS</h3>{report.snapshot.dns.filter((item) => item.addressFamily === 2 && item.serverAddresses.length).map((item) => <div className="detail-row" key={item.interfaceIndex}><span>{item.interfaceAlias}</span><b>{item.serverAddresses.join(", ")}</b></div>)}</article>
          </section>
        </>
      )}
    </>
  );

  const renderRepairs = () => {
    const groups = [
      { risk: "low" as const, title: "安全修复", subtitle: "范围明确，通常不需要重启" },
      { risk: "medium" as const, title: "进阶修复", subtitle: "可能短暂断网或需要管理员权限" },
      { risk: "high" as const, title: "重置工具", subtitle: "仅在明确需要时使用，操作前会强制备份" },
    ];
    return (
      <>
        <section className="page-heading"><div><span className="eyebrow">白名单操作</span><h1>修复工具</h1><p>每项操作都说明改什么、风险多大、是否需要重启。</p></div><div className="admin-pill"><Shield size={16} />{appInfo?.isAdmin ? "当前已是管理员" : "需要时才弹出管理员授权"}</div></section>
        {groups.map((group) => <section className="repair-group" key={group.risk}><div className="repair-group-heading"><div><h2>{group.title}</h2><p>{group.subtitle}</p></div><span className={`risk risk-${group.risk}`}>{riskText[group.risk]}</span></div><div className="repair-grid">{actions.filter((action) => action.risk === group.risk).map((action) => {
          const recommended = recommendedActionIds.has(action.id);
          const tooltipId = `repair-help-${action.id}`;
          return <article className={`repair-card ${recommended ? "recommended" : ""}`} key={action.id}>{recommended && <span className="recommend-label"><Zap size={13} /> 当前建议</span>}<div className={`repair-icon risk-${action.risk}`}>{action.id.includes("reset") || action.id === "full-network-reset" ? <RotateCcw size={21} /> : <Wrench size={21} />}</div><div className="repair-title-row"><h3>{action.title}</h3><span className="repair-help"><button type="button" aria-label={`了解${action.title}适用情况`} aria-describedby={tooltipId}><CircleHelp size={15} /></button><span className="repair-tooltip" id={tooltipId} role="tooltip"><strong>什么时候用</strong><span>{action.recommendedFor}</span></span></span></div><p>{action.description}</p><div className="repair-meta"><span>{action.requiresAdmin ? <Shield size={14} /> : <Check size={14} />}{action.requiresAdmin ? "需管理员" : "普通权限"}</span><span>{action.restartRequired ? <Power size={14} /> : <Clock3 size={14} />}{action.restartRequired ? "需重启" : "立即生效"}</span></div><button className="card-button" onClick={() => void openPreview(action.id)}>查看并执行 <ChevronRight size={15} /></button></article>;
        })}</div></section>)}
      </>
    );
  };

  const renderSnapshots = () => (
    <>
      <section className="page-heading"><div><span className="eyebrow">可回滚保护</span><h1>备份与还原</h1><p>快照保存在本机，不会上传。可选择只还原代理、DNS、Hosts 或防火墙。</p></div><div className="heading-actions"><button className="ghost-button" onClick={() => void networkRepair.app.openDataDirectory()}><FolderOpen size={17} /> 打开目录</button><button className="primary-button" onClick={() => void createSnapshot()} disabled={busy}><DatabaseBackup size={17} /> 创建快照</button></div></section>
      <div className="snapshot-list">{snapshots.length ? snapshots.map((snapshot, index) => <article className="snapshot-card" key={snapshot.id}><span className={`snapshot-dot ${index === 0 ? "latest" : ""}`}><FileClock size={19} /></span><div className="snapshot-copy"><div><h3>{snapshot.reason}</h3>{index === 0 && <span className="latest-label">最新</span>}</div><p>{formatTime(snapshot.createdAt)} · {snapshot.computerName} · {formatBytes(snapshot.sizeBytes)}</p><code>{snapshot.id}</code></div><div className="snapshot-actions"><button className="restore-button" onClick={() => { setRestoreScopes(["proxy", "dns"]); setRestoreSnapshot(snapshot); }}><ArchiveRestore size={16} /> 选择还原</button><button className="icon-button danger" title="删除快照" onClick={() => void deleteSnapshot(snapshot)}><Trash2 size={16} /></button></div></article>) : <div className="large-empty"><DatabaseBackup size={36} /><h2>还没有网络快照</h2><p>第一次修复时会自动创建，你也可以现在手动备份。</p><button className="primary-button" onClick={() => void createSnapshot()}>创建第一个快照</button></div>}</div>
    </>
  );

  const renderHistory = () => (
    <>
      <section className="page-heading"><div><span className="eyebrow">本机审计</span><h1>操作记录</h1><p>每次检测、备份、修复、失败和还原都有迹可循。</p></div><button className="ghost-button" onClick={() => void networkRepair.app.openDataDirectory()}><FolderOpen size={17} /> 查看原始文件</button></section>
      <section className="audit-list">{audit.length ? audit.map((entry, index) => <article key={`${entry.timestamp}-${index}`}><span className={`audit-icon ${entry.success ? "ok" : "failed"}`}>{entry.success ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}</span><div><h3>{entry.title}</h3><p>{entry.detail}</p></div><time>{formatTime(entry.timestamp)}</time></article>) : <div className="large-empty"><History size={36} /><h2>暂无操作记录</h2><p>完成一次体检后，记录会显示在这里。</p></div>}</section>
    </>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="app-brand">
          <img src="./icon.png" alt="" />
          <div><strong>网络急救箱</strong><small>Network First Aid</small></div>
        </div>
        <nav className="top-navigation" aria-label="功能导航">
          {navigation.map((item) => <button className={page === item.id ? "active" : ""} key={item.id} onClick={() => setPage(item.id)}>
            <item.icon size={17} />
            <span>{item.label}</span>
            {item.id === "diagnostics" && report && report.issues.some((issue) => issue.severity === "critical") && <i />}
          </button>)}
        </nav>
        <div className="header-tools">
          <button className={updateResult?.updateAvailable ? "has-update" : ""} title="检查更新" aria-label={checkingUpdate ? "正在检查更新" : "检查更新"} onClick={() => void checkForUpdates()} disabled={checkingUpdate}>
            <RefreshCcw className={checkingUpdate ? "spin" : ""} size={15} />
            <span>{checkingUpdate ? "检查中" : updateResult?.updateAvailable ? "发现更新" : "检查更新"}</span>
          </button>
          <button title="支持作者" onClick={() => setSupportOpen(true)}><HeartHandshake size={15} /><span>支持作者</span></button>
        </div>
        <div className="window-controls">
          <button className="minimize-control" aria-label="最小化" title="最小化" onClick={() => void networkRepair.app.minimize()}><Minus size={18} strokeWidth={2.2} /></button>
          <button aria-label="最大化" title="最大化" onClick={() => void networkRepair.app.toggleMaximize()}><Maximize2 size={14} /></button>
          <button className="close-control" aria-label="关闭" title="关闭" onClick={() => void networkRepair.app.close()}><X size={16} /></button>
        </div>
      </header>
      <main className={`main-content page-${page}`}>{page === "overview" && renderOverview()}{page === "diagnostics" && renderDiagnostics()}{page === "repairs" && renderRepairs()}{page === "snapshots" && renderSnapshots()}{page === "history" && renderHistory()}</main>

      {notice && <div className={`toast toast-${notice.kind}`}>{notice.kind === "success" ? <CheckCircle2 size={18} /> : <XCircle size={18} />}<span>{notice.text}</span><button onClick={() => setNotice(undefined)}><X size={15} /></button></div>}

      {preview && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setPreview(undefined); }}><section className="modal" role="dialog" aria-modal="true" aria-label="确认修复"><div className="modal-head"><span className={`modal-symbol risk-${preview.action.risk}`}>{preview.action.risk === "high" ? <ShieldAlert size={22} /> : <Wrench size={22} />}</span><div><span className="eyebrow">操作预览</span><h2>{preview.action.title}</h2></div><button className="icon-button" onClick={() => setPreview(undefined)} disabled={busy}><X size={18} /></button></div><p className="modal-description">{preview.action.description}</p><div className="preview-block"><h3>将执行以下步骤</h3><ol>{preview.action.steps.map((step) => <li key={step}><span><Check size={13} /></span>{step}</li>)}</ol></div><div className="preview-facts"><span><DatabaseBackup size={16} /><b>自动快照</b>：执行前创建</span><span><Shield size={16} /><b>权限</b>：{preview.action.requiresAdmin ? "将弹出 Windows 管理员授权" : "无需管理员"}</span><span><Power size={16} /><b>重启</b>：{preview.action.restartRequired ? "完成后需要" : "不需要"}</span></div>{preview.warnings.map((warning) => <div className="warning-line" key={warning}><AlertTriangle size={16} />{warning}</div>)}{preview.action.risk === "high" && <label className="confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><Check size={13} /></span>我已了解影响，并确认执行此高风险操作</label>}<div className="modal-actions"><button className="ghost-button" onClick={() => setPreview(undefined)} disabled={busy}>取消</button><button className={`primary-button ${preview.action.risk === "high" ? "danger-primary" : ""}`} onClick={() => void runAction()} disabled={busy || (preview.action.risk === "high" && !confirmed)}>{busy ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}{busy ? "正在执行…" : "备份并执行"}</button></div></section></div>}

      {restoreSnapshot && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label="选择还原内容"><div className="modal-head"><span className="modal-symbol risk-low"><ArchiveRestore size={22} /></span><div><span className="eyebrow">选择性还原</span><h2>{restoreSnapshot.reason}</h2></div><button className="icon-button" onClick={() => setRestoreSnapshot(undefined)} disabled={busy}><X size={18} /></button></div><p className="modal-description">快照时间：{formatTime(restoreSnapshot.createdAt)}。还原只覆盖你勾选的内容。</p><div className="scope-list">{scopeOptions.map((scope) => { const checked = restoreScopes.includes(scope.id); return <label key={scope.id}><input type="checkbox" checked={checked} onChange={() => setRestoreScopes((current) => checked ? current.filter((item) => item !== scope.id) : [...current, scope.id])} /><span className="scope-check">{checked && <Check size={13} />}</span><div><strong>{scope.label}</strong><small>{scope.detail}</small></div></label>; })}</div><div className="warning-line"><Info size={16} />还原需要管理员授权；不存在的网卡会被自动跳过。</div><div className="modal-actions"><button className="ghost-button" onClick={() => setRestoreSnapshot(undefined)} disabled={busy}>取消</button><button className="primary-button" onClick={() => void runRestore()} disabled={busy || restoreScopes.length === 0}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArchiveRestore size={17} />}{busy ? "正在还原…" : `还原 ${restoreScopes.length} 项`}</button></div></section></div>}

      {updateOpen && updateResult && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setUpdateOpen(false); }}><section className="modal update-modal" role="dialog" aria-modal="true" aria-label="发现新版本"><div className="modal-head"><span className="modal-symbol update-symbol"><Download size={22} /></span><div><span className="eyebrow">软件更新</span><h2>发现新版本 v{updateResult.latestVersion}</h2></div><button className="icon-button" aria-label="关闭更新窗口" onClick={() => setUpdateOpen(false)}><X size={18} /></button></div><div className="version-route"><div><small>当前版本</small><strong>v{updateResult.currentVersion}</strong></div><ChevronRight size={19} /><div className="latest-version"><small>最新版本</small><strong>v{updateResult.latestVersion}</strong></div></div><p className="modal-description">{updateResult.releaseName.replace(/[\u2013\u2014]/g, "-")}。下载页面由 GitHub 官方托管，更新前可以先查看完整说明和校验值。</p><div className="modal-actions"><button className="ghost-button" onClick={() => setUpdateOpen(false)}>稍后再说</button><button className="primary-button" onClick={() => void openLatestRelease()}><Download size={17} /> 前往下载</button></div></section></div>}

      {supportOpen && <div className="modal-backdrop support-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSupportOpen(false); }}><section className="modal support-modal" role="dialog" aria-modal="true" aria-label="支持作者"><button className="icon-button support-close" aria-label="关闭支持窗口" onClick={() => setSupportOpen(false)}><X size={18} /></button><div className="support-copy"><span className="support-mark"><Bandage size={24} /></span><span className="eyebrow">支持作者</span><h2>网络修好了，给急救箱补块创可贴</h2><p>你的支持会用来继续修 Bug、跟进 Windows 更新，也让我知道这个小工具真的帮上了忙。</p><div className="support-list"><span><Coffee size={16} /> 继续打磨体验</span><span><ShieldCheck size={16} /> 保持安全可回滚</span><span><Wrench size={16} /> 适配更多网络问题</span></div></div><div className="qr-card"><div className="qr-halo" aria-hidden="true"><HeartHandshake size={32} /></div><div className="qr-image"><img src="./support-wechat.jpg" alt="微信赞赏二维码" draggable={false} /></div><strong>微信扫码支持</strong><small>金额随意，心意已经收到</small></div></section></div>}
    </div>
  );
}
