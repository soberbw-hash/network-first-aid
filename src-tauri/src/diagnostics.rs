use std::{path::Path, time::Duration, time::Instant};

use chrono::Utc;
use regex::Regex;
use serde_json::Value;

use crate::{
    models::{ConnectivityResult, ScanCapture},
    powershell::{escape_single_quoted, run_powershell},
};

const DIAGNOSTIC_SCRIPT: &str = include_str!("../resources/diagnostics.ps1");
const CONNECTIVITY_SCRIPT: &str = include_str!("../resources/connectivity.ps1");

pub fn capture_raw(data_dir: &Path) -> Result<Value, String> {
    let output = run_powershell(data_dir, DIAGNOSTIC_SCRIPT, Duration::from_secs(60))?;
    if output.is_empty() {
        return Err("Windows 没有返回网络配置".to_string());
    }
    serde_json::from_str(&output).map_err(|error| format!("网络配置解析失败：{error}"))
}

fn proxy_endpoint(snapshot: &Value) -> Option<String> {
    let server = snapshot.pointer("/proxy/server")?.as_str()?;
    let pattern =
        Regex::new(r"(?i)(?:^|=)(?:https?://)?(?P<host>127\.0\.0\.1|localhost):(?P<port>\d+)$")
            .ok()?;
    server.split(';').find_map(|part| {
        let captures = pattern.captures(part.trim())?;
        let host = captures.name("host")?.as_str();
        let port: u16 = captures.name("port")?.as_str().parse().ok()?;
        Some(format!("http://{host}:{port}"))
    })
}

fn connectivity(data_dir: &Path, snapshot: &Value) -> Result<Vec<ConnectivityResult>, String> {
    let endpoint = proxy_endpoint(snapshot).unwrap_or_default();
    let script =
        CONNECTIVITY_SCRIPT.replace("__PROXY_ENDPOINT__", &escape_single_quoted(&endpoint));
    let output = run_powershell(data_dir, &script, Duration::from_secs(30))?;
    serde_json::from_str(&output).map_err(|error| format!("连通性结果解析失败：{error}"))
}

pub fn scan(data_dir: &Path) -> Result<ScanCapture, String> {
    let started = Instant::now();
    let snapshot = capture_raw(data_dir)?;
    let connectivity = connectivity(data_dir, &snapshot)?;
    Ok(ScanCapture {
        generated_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        duration_ms: started.elapsed().as_millis() as u64,
        snapshot,
        connectivity,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_supported_local_proxy_formats() {
        for server in [
            "127.0.0.1:12450",
            "http=127.0.0.1:7890;https=127.0.0.1:7890",
            "socks=localhost:1080",
        ] {
            let snapshot = json!({ "proxy": { "server": server } });
            assert!(proxy_endpoint(&snapshot).is_some(), "{server}");
        }
    }

    #[test]
    fn rejects_remote_or_invalid_proxy_endpoints() {
        for server in ["proxy.example.com:8080", "127.0.0.1:70000", "not-a-proxy"] {
            let snapshot = json!({ "proxy": { "server": server } });
            assert!(proxy_endpoint(&snapshot).is_none(), "{server}");
        }
    }

    #[test]
    #[ignore = "manual smoke test: reads current Windows networking and performs egress probes"]
    fn captures_current_machine() {
        let directory =
            std::env::temp_dir().join(format!("network-first-aid-{}", uuid::Uuid::new_v4()));
        let capture = scan(&directory).expect("real diagnostic scan should complete");
        assert!(capture.snapshot.get("computerName").is_some());
        assert!(capture.snapshot.get("adapters").is_some());
        assert!(capture.connectivity.len() >= 2);
        println!(
            "diagnostic smoke: {} ms, {} connectivity probes",
            capture.duration_ms,
            capture.connectivity.len()
        );
        let _ = std::fs::remove_dir_all(directory);
    }
}
