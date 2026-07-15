use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use regex::Regex;

use crate::{
    audit, diagnostics,
    models::{SnapshotSummary, StoredSnapshot},
};

fn snapshot_root(data_dir: &Path) -> PathBuf {
    data_dir.join("snapshots")
}

fn valid_id(id: &str) -> bool {
    Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$")
        .is_ok_and(|pattern| pattern.is_match(id))
}

pub fn resolve(data_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("快照编号无效".to_string());
    }
    Ok(snapshot_root(data_dir).join(id))
}

fn directory_size(directory: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                directory_size(&path)
            } else {
                entry.metadata().map_or(0, |metadata| metadata.len())
            }
        })
        .sum()
}

fn computer_name(stored: &StoredSnapshot) -> String {
    stored
        .raw
        .get("computerName")
        .and_then(|value| value.as_str())
        .unwrap_or("Windows PC")
        .to_string()
}

pub fn create(data_dir: &Path, reason: Option<&str>) -> Result<SnapshotSummary, String> {
    let now = Utc::now();
    let id = now.format("%Y-%m-%dT%H-%M-%S-%3fZ").to_string();
    let created_at = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let reason: String = reason.unwrap_or("手动备份").chars().take(160).collect();
    let directory = resolve(data_dir, &id)?;
    fs::create_dir_all(&directory).map_err(|error| format!("创建快照目录失败：{error}"))?;
    let raw = diagnostics::capture_raw(data_dir)?;
    let stored = StoredSnapshot {
        schema_version: 1,
        id: id.clone(),
        created_at: created_at.clone(),
        reason: reason.clone(),
        raw,
    };
    let json = serde_json::to_string_pretty(&stored).map_err(|error| error.to_string())?;
    fs::write(directory.join("snapshot.json"), json)
        .map_err(|error| format!("保存网络快照失败：{error}"))?;

    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let hosts = PathBuf::from(system_root)
        .join("System32")
        .join("drivers")
        .join("etc")
        .join("hosts");
    let _ = fs::copy(hosts, directory.join("hosts"));
    let summary = SnapshotSummary {
        id: id.clone(),
        created_at,
        reason: reason.clone(),
        computer_name: computer_name(&stored),
        size_bytes: directory_size(&directory),
    };
    let _ = audit::write(
        data_dir,
        "backup",
        "已创建网络快照",
        &format!("{reason} · {id}"),
        true,
    );
    Ok(summary)
}

pub fn read(data_dir: &Path, id: &str) -> Result<StoredSnapshot, String> {
    let raw = fs::read_to_string(resolve(data_dir, id)?.join("snapshot.json"))
        .map_err(|error| format!("读取快照失败：{error}"))?;
    let snapshot: StoredSnapshot =
        serde_json::from_str(&raw).map_err(|error| format!("快照格式无效：{error}"))?;
    if snapshot.schema_version != 1 || snapshot.id != id {
        return Err("快照格式不受支持".to_string());
    }
    Ok(snapshot)
}

pub fn list(data_dir: &Path) -> Vec<SnapshotSummary> {
    let root = snapshot_root(data_dir);
    let _ = fs::create_dir_all(&root);
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut summaries: Vec<SnapshotSummary> = entries
        .flatten()
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().to_string();
            if !entry.path().is_dir() || !valid_id(&id) {
                return None;
            }
            let stored = read(data_dir, &id).ok()?;
            Some(SnapshotSummary {
                id: stored.id.clone(),
                created_at: stored.created_at.clone(),
                reason: stored.reason.clone(),
                computer_name: computer_name(&stored),
                size_bytes: directory_size(&entry.path()),
            })
        })
        .collect();
    summaries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    summaries
}

pub fn remove(data_dir: &Path, id: &str) -> Result<(), String> {
    let directory = resolve(data_dir, id)?;
    if directory.exists() {
        fs::remove_dir_all(directory).map_err(|error| format!("删除快照失败：{error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_ids_cannot_escape_the_snapshot_root() {
        assert!(valid_id("2026-07-15T12-34-56-789Z"));
        assert!(!valid_id("../audit.jsonl"));
        assert!(!valid_id("2026-07-15T12-34-56Z"));
        assert!(resolve(Path::new("C:/data"), "../../Windows").is_err());
    }

    #[test]
    fn snapshot_read_list_remove_round_trip_preserves_settings() {
        let data_dir =
            std::env::temp_dir().join(format!("network-first-aid-{}", uuid::Uuid::new_v4()));
        let id = "2026-07-15T12-34-56-789Z";
        let directory = resolve(&data_dir, id).expect("valid snapshot id");
        fs::create_dir_all(&directory).expect("create snapshot fixture");
        let fixture = StoredSnapshot {
            schema_version: 1,
            id: id.to_string(),
            created_at: "2026-07-15T12:34:56.789Z".to_string(),
            reason: "测试备份".to_string(),
            raw: json!({
                "computerName": "SNAPSHOT-TEST",
                "proxy": { "server": "http://127.0.0.1:12450" }
            }),
        };
        fs::write(
            directory.join("snapshot.json"),
            serde_json::to_string_pretty(&fixture).expect("serialize fixture"),
        )
        .expect("write fixture");

        let stored = read(&data_dir, id).expect("read snapshot");
        assert_eq!(stored.raw["proxy"]["server"], "http://127.0.0.1:12450");
        let summaries = list(&data_dir);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].computer_name, "SNAPSHOT-TEST");
        remove(&data_dir, id).expect("remove snapshot");
        assert!(list(&data_dir).is_empty());
        let _ = fs::remove_dir_all(data_dir);
    }
}
