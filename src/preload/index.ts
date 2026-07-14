import { contextBridge, ipcRenderer } from "electron";

import { IPC, type NetworkRepairApi } from "../shared/contracts";

const api: NetworkRepairApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    minimize: () => ipcRenderer.invoke(IPC.minimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.toggleMaximize),
    close: () => ipcRenderer.invoke(IPC.close),
    openDataDirectory: () => ipcRenderer.invoke(IPC.openDataDirectory),
  },
  diagnostics: {
    scan: () => ipcRenderer.invoke(IPC.scan),
  },
  repairs: {
    list: () => ipcRenderer.invoke(IPC.repairList),
    preview: (actionId) => ipcRenderer.invoke(IPC.repairPreview, actionId),
    run: (actionId) => ipcRenderer.invoke(IPC.repairRun, actionId),
  },
  snapshots: {
    list: () => ipcRenderer.invoke(IPC.snapshotList),
    create: (reason) => ipcRenderer.invoke(IPC.snapshotCreate, reason),
    restore: (snapshotId, scopes) => ipcRenderer.invoke(IPC.snapshotRestore, snapshotId, scopes),
    remove: (snapshotId) => ipcRenderer.invoke(IPC.snapshotRemove, snapshotId),
  },
  audit: {
    list: () => ipcRenderer.invoke(IPC.auditList),
  },
};

contextBridge.exposeInMainWorld("networkRepair", api);
