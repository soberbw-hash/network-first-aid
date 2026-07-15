use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use chrono::Utc;

use crate::models::AuditEntry;

pub fn write(
    data_dir: &Path,
    kind: &str,
    title: &str,
    detail: &str,
    success: bool,
) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let entry = AuditEntry {
        timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        kind: kind.to_string(),
        title: title.to_string(),
        detail: detail.to_string(),
        success,
    };
    let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join("audit.jsonl"))
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

pub fn list(data_dir: &Path) -> Vec<AuditEntry> {
    let Ok(raw) = fs::read_to_string(data_dir.join("audit.jsonl")) else {
        return Vec::new();
    };
    let mut entries: Vec<AuditEntry> = raw
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if entries.len() > 200 {
        entries.drain(0..entries.len() - 200);
    }
    entries.reverse();
    entries
}
