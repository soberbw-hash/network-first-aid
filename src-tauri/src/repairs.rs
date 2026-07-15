use std::{collections::HashSet, path::Path, time::Duration};

use serde_json::Value;

use crate::{
    audit,
    models::{ActionResult, RestoreResult},
    powershell::{escape_single_quoted, run_elevated, run_powershell},
    snapshots,
};

const REPAIR_SCRIPT: &str = include_str!("../resources/repair.ps1");
const RESTORE_SCRIPT: &str = include_str!("../resources/restore.ps1");

struct ActionMeta {
    title: &'static str,
    requires_admin: bool,
    restart_required: bool,
}

fn action_meta(id: &str) -> Result<ActionMeta, String> {
    let meta = match id {
        "quick-repair" => ("智能安全修复", true, false),
        "flush-dns" => ("刷新 DNS 缓存", false, false),
        "renew-dhcp" => ("重新获取 IP", true, false),
        "dns-auto" => ("DNS 恢复自动", true, false),
        "disable-dead-proxy" => ("关闭失效系统代理", false, false),
        "reset-winhttp-proxy" => ("重置 WinHTTP 代理", true, false),
        "sync-winhttp-proxy" => ("同步系统代理到 WinHTTP", true, false),
        "normalize-proxy-bypass" => ("补全局域网直连规则", false, false),
        "remove-orphan-tun-routes" => ("清理断开的 TUN 路由", true, false),
        "restart-active-adapters" => ("重启当前网卡", true, false),
        "reset-winsock" => ("重置 Winsock", true, true),
        "reset-tcpip" => ("重置 TCP/IP", true, true),
        "reset-firewall" => ("重置防火墙规则", true, false),
        "reset-hosts" => ("重置 Hosts 文件", true, false),
        "full-network-reset" => ("彻底重装网络组件", true, true),
        _ => return Err("拒绝执行未列入白名单的操作".to_string()),
    };
    Ok(ActionMeta {
        title: meta.0,
        requires_admin: meta.1,
        restart_required: meta.2,
    })
}

fn parse_logs(output: &str) -> Vec<String> {
    if output.is_empty() {
        return Vec::new();
    }
    match serde_json::from_str::<Value>(output) {
        Ok(Value::Array(items)) => items
            .into_iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect(),
        Ok(Value::String(item)) => vec![item],
        _ => Vec::new(),
    }
}

fn run_standard(data_dir: &Path, body: &str) -> Result<Vec<String>, String> {
    let script = format!(
        r#"
$logs = [System.Collections.Generic.List[string]]::new()
function Add-Log([string]$message) {{ $logs.Add($message) }}
{body}
ConvertTo-Json -InputObject @($logs) -Compress
"#
    );
    run_powershell(data_dir, &script, Duration::from_secs(180)).map(|output| parse_logs(&output))
}

pub fn run(data_dir: &Path, action_id: &str) -> Result<ActionResult, String> {
    let meta = action_meta(action_id)?;
    let snapshot = snapshots::create(data_dir, Some(&format!("执行前备份：{}", meta.title)))?;
    let snapshot_dir = snapshots::resolve(data_dir, &snapshot.id)?;
    let script = REPAIR_SCRIPT
        .replace("__ACTION_ID__", &escape_single_quoted(action_id))
        .replace(
            "__SNAPSHOT_DIRECTORY__",
            &escape_single_quoted(&snapshot_dir.to_string_lossy()),
        );
    let outcome = if meta.requires_admin {
        run_elevated(data_dir, &script, Duration::from_secs(240))
    } else {
        run_standard(data_dir, &script)
    };
    match outcome {
        Ok(logs) => {
            let message = format!(
                "{}已完成{}",
                meta.title,
                if meta.restart_required {
                    "，请重启电脑"
                } else {
                    ""
                }
            );
            let _ = audit::write(
                data_dir,
                "repair",
                meta.title,
                &format!("{message} · 回滚快照 {}", snapshot.id),
                true,
            );
            Ok(ActionResult {
                success: true,
                action_id: action_id.to_string(),
                snapshot_id: Some(snapshot.id),
                message,
                logs,
                restart_required: meta.restart_required,
            })
        }
        Err(message) => {
            let _ = audit::write(
                data_dir,
                "error",
                &format!("{}失败", meta.title),
                &format!("{message} · 配置快照 {} 已保留", snapshot.id),
                false,
            );
            Ok(ActionResult {
                success: false,
                action_id: action_id.to_string(),
                snapshot_id: Some(snapshot.id),
                message,
                logs: Vec::new(),
                restart_required: false,
            })
        }
    }
}

pub fn restore(
    data_dir: &Path,
    snapshot_id: &str,
    raw_scopes: Vec<String>,
) -> Result<RestoreResult, String> {
    if raw_scopes.is_empty() {
        return Err("请至少选择一项还原内容".to_string());
    }
    let allowed: HashSet<&str> = ["proxy", "dns", "hosts", "firewall"].into_iter().collect();
    let mut seen = HashSet::new();
    let scopes: Vec<String> = raw_scopes
        .into_iter()
        .filter(|scope| seen.insert(scope.clone()))
        .map(|scope| {
            if allowed.contains(scope.as_str()) {
                Ok(scope)
            } else {
                Err("还原范围不在白名单中".to_string())
            }
        })
        .collect::<Result<_, _>>()?;
    snapshots::read(data_dir, snapshot_id)?;
    let directory = snapshots::resolve(data_dir, snapshot_id)?;
    let scope_literal = scopes
        .iter()
        .map(|scope| format!("'{}'", escape_single_quoted(scope)))
        .collect::<Vec<_>>()
        .join(",");
    let script = RESTORE_SCRIPT
        .replace(
            "__SNAPSHOT_PATH__",
            &escape_single_quoted(&directory.join("snapshot.json").to_string_lossy()),
        )
        .replace(
            "__HOSTS_PATH__",
            &escape_single_quoted(&directory.join("hosts").to_string_lossy()),
        )
        .replace(
            "__FIREWALL_PATH__",
            &escape_single_quoted(&directory.join("firewall.wfw").to_string_lossy()),
        )
        .replace("__SCOPES__", &scope_literal);
    match run_elevated(data_dir, &script, Duration::from_secs(240)) {
        Ok(logs) => {
            let _ = audit::write(
                data_dir,
                "restore",
                "网络配置已还原",
                &format!("{snapshot_id} · {}", scopes.join("、")),
                true,
            );
            Ok(RestoreResult {
                success: true,
                snapshot_id: snapshot_id.to_string(),
                scopes,
                message: "所选网络配置已还原".to_string(),
                logs,
            })
        }
        Err(message) => {
            let _ = audit::write(
                data_dir,
                "error",
                "网络配置还原失败",
                &format!("{snapshot_id} · {message}"),
                false,
            );
            Ok(RestoreResult {
                success: false,
                snapshot_id: snapshot_id.to_string(),
                scopes,
                message,
                logs: Vec::new(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_actions_are_allowed() {
        assert!(action_meta("quick-repair").is_ok());
        assert!(action_meta("run-anything").is_err());
    }
}
