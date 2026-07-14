import { BrowserWindow, ipcMain, shell } from "electron";

import { IPC, type RepairActionId, type RestoreScope } from "../shared/contracts";
import { AuditService } from "./audit";
import { DiagnosticsService } from "./diagnostics";
import { RepairService } from "./repairs";
import { SnapshotService } from "./snapshots";
import { isRunningAsAdministrator } from "./powershell";

interface RegisterOptions {
  getWindow: () => BrowserWindow | null;
  version: string;
  dataDirectory: string;
  diagnostics: DiagnosticsService;
  repairs: RepairService;
  snapshots: SnapshotService;
  audit: AuditService;
}

export const registerIpc = (options: RegisterOptions): void => {
  const handle = <T extends unknown[], R>(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: T) => R | Promise<R>,
  ) => {
    ipcMain.handle(channel, (event, ...args: T) => {
      if (event.sender !== options.getWindow()?.webContents) {
        throw new Error("拒绝来自非主窗口的请求");
      }
      return listener(event, ...args);
    });
  };

  handle(IPC.appInfo, async () => ({
    version: options.version,
    platform: process.platform,
    isAdmin: await isRunningAsAdministrator(),
    dataDirectory: options.dataDirectory,
  }));
  handle(IPC.minimize, () => options.getWindow()?.minimize());
  handle(IPC.toggleMaximize, () => {
    const window = options.getWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  handle(IPC.close, () => options.getWindow()?.close());
  handle(IPC.openDataDirectory, () => shell.openPath(options.dataDirectory));
  handle(IPC.scan, async () => {
    try {
      const report = await options.diagnostics.scan();
      await options.audit.write({
        kind: "scan",
        title: "网络体检完成",
        detail: `健康度 ${report.score} · ${report.issues.length} 条结果`,
        success: true,
      });
      return report;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await options.audit.write({ kind: "error", title: "网络体检失败", detail, success: false });
      throw error;
    }
  });
  handle(IPC.repairList, () => options.repairs.list());
  handle(IPC.repairPreview, (_event, actionId: RepairActionId) => options.repairs.preview(actionId));
  handle(IPC.repairRun, (_event, actionId: RepairActionId) => options.repairs.run(actionId));
  handle(IPC.snapshotList, () => options.snapshots.list());
  handle(IPC.snapshotCreate, (_event, reason?: string) =>
    options.snapshots.create(typeof reason === "string" ? reason : undefined),
  );
  handle(IPC.snapshotRestore, (_event, snapshotId: string, scopes: RestoreScope[]) =>
    options.repairs.restore(snapshotId, scopes),
  );
  handle(IPC.snapshotRemove, (_event, snapshotId: string) => options.snapshots.remove(snapshotId));
  handle(IPC.auditList, () => options.audit.list());
};
