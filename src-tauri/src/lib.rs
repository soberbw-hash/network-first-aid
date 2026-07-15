mod audit;
mod diagnostics;
mod models;
mod powershell;
mod repairs;
mod snapshots;
mod updates;

use std::{fs, path::PathBuf, process::Command};

use models::{
    ActionResult, AppInfo, AppState, AuditEntry, RestoreResult, ScanCapture, SnapshotSummary,
};
use tauri::{Manager, State, WebviewWindow};

fn app_data_directory() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("network-first-aid")
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务异常：{error}"))?
}

#[tauri::command]
async fn app_info(state: State<'_, AppState>) -> Result<AppInfo, String> {
    let data_dir = state.data_dir.clone();
    let admin_dir = data_dir.clone();
    let is_admin = blocking(move || Ok(powershell::is_admin(&admin_dir))).await?;
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: "win32".to_string(),
        is_admin,
        data_directory: data_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_data_directory(state: State<'_, AppState>) -> Result<(), String> {
    fs::create_dir_all(&state.data_dir).map_err(|error| error.to_string())?;
    Command::new("explorer.exe")
        .arg(&state.data_dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开数据目录失败：{error}"))
}

#[tauri::command]
fn open_latest_release() -> Result<(), String> {
    Command::new("explorer.exe")
        .arg("https://github.com/soberbw-hash/network-first-aid/releases/latest")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开更新页面失败：{error}"))
}

#[tauri::command]
async fn diagnostics_scan(state: State<'_, AppState>) -> Result<ScanCapture, String> {
    let data_dir = state.data_dir.clone();
    blocking(move || diagnostics::scan(&data_dir)).await
}

#[tauri::command]
async fn update_latest_release(
    state: State<'_, AppState>,
) -> Result<models::LatestRelease, String> {
    let data_dir = state.data_dir.clone();
    blocking(move || updates::latest_release(&data_dir)).await
}

#[tauri::command]
fn audit_scan_result(
    state: State<'_, AppState>,
    score: u8,
    issue_count: u16,
) -> Result<(), String> {
    if score > 100 || issue_count > 1000 {
        return Err("体检结果范围无效".to_string());
    }
    audit::write(
        &state.data_dir,
        "scan",
        "网络体检完成",
        &format!("健康度 {score} · {issue_count} 条结果"),
        true,
    )
}

#[tauri::command]
async fn repair_run(state: State<'_, AppState>, action_id: String) -> Result<ActionResult, String> {
    let data_dir = state.data_dir.clone();
    blocking(move || repairs::run(&data_dir, &action_id)).await
}

#[tauri::command]
fn snapshot_list(state: State<'_, AppState>) -> Vec<SnapshotSummary> {
    snapshots::list(&state.data_dir)
}

#[tauri::command]
async fn snapshot_create(
    state: State<'_, AppState>,
    reason: Option<String>,
) -> Result<SnapshotSummary, String> {
    let data_dir = state.data_dir.clone();
    blocking(move || snapshots::create(&data_dir, reason.as_deref())).await
}

#[tauri::command]
async fn snapshot_restore(
    state: State<'_, AppState>,
    snapshot_id: String,
    scopes: Vec<String>,
) -> Result<RestoreResult, String> {
    let data_dir = state.data_dir.clone();
    blocking(move || repairs::restore(&data_dir, &snapshot_id, scopes)).await
}

#[tauri::command]
fn snapshot_remove(state: State<'_, AppState>, snapshot_id: String) -> Result<(), String> {
    snapshots::remove(&state.data_dir, &snapshot_id)
}

#[tauri::command]
fn audit_list(state: State<'_, AppState>) -> Vec<AuditEntry> {
    audit::list(&state.data_dir)
}

pub fn run() {
    let data_dir = app_data_directory();
    if let Err(error) = fs::create_dir_all(&data_dir) {
        eprintln!("Cannot create Network First Aid data directory: {error}");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(AppState { data_dir })
        .invoke_handler(tauri::generate_handler![
            app_info,
            minimize_window,
            toggle_maximize_window,
            close_window,
            open_data_directory,
            open_latest_release,
            diagnostics_scan,
            update_latest_release,
            audit_scan_result,
            repair_run,
            snapshot_list,
            snapshot_create,
            snapshot_restore,
            snapshot_remove,
            audit_list,
        ])
        .run(tauri::generate_context!())
        .expect("Network First Aid failed to start");
}
