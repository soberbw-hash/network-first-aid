import { invoke } from "@tauri-apps/api/core";

import { getRepairAction, REPAIR_ACTIONS } from "../../shared/action-catalog";
import type {
  AppInfo,
  NetworkRepairApi,
  RepairActionId,
  ScanCapture,
  UpdateCheckResult,
} from "../../shared/contracts";
import { buildScanReport } from "../../shared/diagnostics-analysis";
import { isAllowedReleaseUrl } from "../../shared/update-policy";
import { isNewerVersion, normalizeVersion } from "../../shared/version";

interface GitHubRelease {
  tagName: string;
  name: string | null;
  htmlUrl: string;
  draft: boolean;
  prerelease: boolean;
}

const isGitHubRelease = (value: unknown): value is GitHubRelease => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GitHubRelease>;
  return (
    typeof candidate.tagName === "string" &&
    (typeof candidate.name === "string" || candidate.name === null) &&
    typeof candidate.htmlUrl === "string" &&
    candidate.draft === false &&
    candidate.prerelease === false
  );
};

const checkForUpdates = async (): Promise<UpdateCheckResult> => {
  const [appInfo, payload] = await Promise.all([
    invoke<AppInfo>("app_info"),
    invoke<unknown>("update_latest_release"),
  ]);
  if (!isGitHubRelease(payload) || !isAllowedReleaseUrl(payload.htmlUrl)) {
    throw new Error("GitHub 返回的版本信息不完整");
  }
  const latestVersion = normalizeVersion(payload.tagName);
  return {
    currentVersion: normalizeVersion(appInfo.version),
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, appInfo.version),
    releaseName: payload.name || `v${latestVersion}`,
    releaseUrl: payload.htmlUrl,
  };
};

const previewAction = (actionId: RepairActionId) => {
  const action = getRepairAction(actionId);
  const warnings: string[] = [];
  if (action.risk === "medium") warnings.push("执行期间网络可能短暂中断");
  if (action.risk === "high") warnings.push("这是高风险操作，请先确认没有依赖自定义网络配置");
  if (action.restartRequired) warnings.push("操作完成后需要重启 Windows 才能完全生效");
  if (action.id === "full-network-reset") warnings.push("虚拟网卡和 VPN/TUN 驱动也会被移除并重新安装");
  return { action, snapshotWillBeCreated: true, warnings };
};

export const networkRepair: NetworkRepairApi = {
  app: {
    info: () => invoke("app_info"),
    minimize: () => invoke("minimize_window"),
    toggleMaximize: () => invoke("toggle_maximize_window"),
    close: () => invoke("close_window"),
    openDataDirectory: () => invoke("open_data_directory"),
    checkForUpdates,
    openLatestRelease: () => invoke("open_latest_release"),
  },
  diagnostics: {
    scan: async () => {
      const report = buildScanReport(await invoke<ScanCapture>("diagnostics_scan"));
      try {
        await invoke("audit_scan_result", {
          score: report.score,
          issueCount: report.issues.filter((issue) => issue.id !== "healthy").length,
        });
      } catch {
        // The report remains useful even if the local audit file is temporarily unavailable.
      }
      return report;
    },
  },
  repairs: {
    list: async () => REPAIR_ACTIONS,
    preview: async (actionId) => previewAction(actionId),
    run: (actionId) => invoke("repair_run", { actionId }),
  },
  snapshots: {
    list: () => invoke("snapshot_list"),
    create: (reason) => invoke("snapshot_create", { reason }),
    restore: (snapshotId, scopes) => invoke("snapshot_restore", { snapshotId, scopes }),
    remove: (snapshotId) => invoke("snapshot_remove", { snapshotId }),
  },
  audit: {
    list: () => invoke("audit_list"),
  },
};
