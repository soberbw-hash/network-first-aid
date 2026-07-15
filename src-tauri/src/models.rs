use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
pub struct AppState {
    pub data_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub is_admin: bool,
    pub data_directory: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityResult {
    pub name: String,
    pub target: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCapture {
    pub generated_at: String,
    pub duration_ms: u64,
    pub snapshot: Value,
    pub connectivity: Vec<ConnectivityResult>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRelease {
    #[serde(rename(deserialize = "tag_name", serialize = "tagName"))]
    pub tag_name: String,
    pub name: Option<String>,
    #[serde(rename(deserialize = "html_url", serialize = "htmlUrl"))]
    pub html_url: String,
    pub draft: bool,
    pub prerelease: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub computer_name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSnapshot {
    pub schema_version: u8,
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub timestamp: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub success: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResult {
    pub success: bool,
    pub action_id: String,
    pub snapshot_id: Option<String>,
    pub message: String,
    pub logs: Vec<String>,
    pub restart_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub success: bool,
    pub snapshot_id: String,
    pub scopes: Vec<String>,
    pub message: String,
    pub logs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElevatedResult {
    pub success: bool,
    #[serde(default)]
    pub logs: Vec<String>,
    pub error: Option<String>,
}
