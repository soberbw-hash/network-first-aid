import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { app, BrowserWindow, dialog } from "electron";

import { AuditService } from "./audit";
import { DiagnosticsService } from "./diagnostics";
import { registerIpc } from "./ipc";
import { RepairService } from "./repairs";
import { SnapshotService } from "./snapshots";

const DEV_SERVER = "http://127.0.0.1:5188";
let mainWindow: BrowserWindow | null = null;

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    title: "网络急救箱",
    icon: path.join(app.getAppPath(), "assets", "icon.ico"),
    backgroundColor: "#f4f8fd",
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, targetUrl) => {
    const allowed = app.isPackaged || process.env.NETFIX_CAPTURE_PATH
      ? targetUrl.startsWith("file:") && targetUrl.endsWith("/dist/index.html")
      : new URL(targetUrl).origin === DEV_SERVER;
    if (!allowed) event.preventDefault();
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.once("ready-to-show", () => window.show());
  if (app.isPackaged || process.env.NETFIX_CAPTURE_PATH) {
    await window.loadFile(path.join(__dirname, "../../dist/index.html"));
  } else {
    await window.loadURL(DEV_SERVER);
  }
  return window;
};

const bootstrap = async (): Promise<void> => {
  const dataDirectory = app.getPath("userData");
  const diagnostics = new DiagnosticsService();
  const audit = new AuditService(dataDirectory);
  const snapshots = new SnapshotService(dataDirectory, diagnostics, audit);
  const repairs = new RepairService(dataDirectory, snapshots, audit);

  registerIpc({
    getWindow: () => mainWindow,
    version: app.getVersion(),
    dataDirectory,
    diagnostics,
    repairs,
    snapshots,
    audit,
  });
  mainWindow = await createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  const capturePath = process.env.NETFIX_CAPTURE_PATH;
  if (capturePath) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    if (process.env.NETFIX_CAPTURE_SCAN === "1") {
      await mainWindow.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('立即体检'))?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    const capturePage = process.env.NETFIX_CAPTURE_PAGE;
    if (capturePage) {
      await mainWindow.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('.top-navigation button')).find((button) =>
          button.textContent?.trim() === ${JSON.stringify(capturePage)})?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (process.env.NETFIX_CAPTURE_PREVIEW === "1") {
      await mainWindow.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('查看并执行'))?.click()
      `);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const image = await mainWindow.capturePage();
    await mkdir(path.dirname(capturePath), { recursive: true });
    await writeFile(capturePath, image.toPNG());
    app.quit();
  }
};

app.setAppUserModelId("com.sober.networkfirstaid");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error("Network First Aid bootstrap failed", error);
      dialog.showErrorBox("网络急救箱启动失败", error instanceof Error ? error.message : String(error));
      app.quit();
    });
}

app.on("window-all-closed", () => app.quit());
