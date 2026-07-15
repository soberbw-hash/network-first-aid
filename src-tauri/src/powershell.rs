use std::{
    fs::{self, File},
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

use uuid::Uuid;
use wait_timeout::ChildExt;

use crate::models::ElevatedResult;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POWERSHELL_PREFIX: &str = r#"
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
"#;

pub fn escape_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

fn write_utf8_bom(path: &Path, content: &str) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    fs::write(path, bytes).map_err(|error| format!("写入 PowerShell 脚本失败：{error}"))
}

fn read_utf8(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim_start_matches('\u{feff}')
        .trim()
        .to_string()
}

pub fn run_powershell(data_dir: &Path, script: &str, timeout: Duration) -> Result<String, String> {
    use std::os::windows::process::CommandExt;

    let job_dir = data_dir
        .join("jobs")
        .join(format!("runtime-{}", Uuid::new_v4()));
    fs::create_dir_all(&job_dir).map_err(|error| format!("创建任务目录失败：{error}"))?;
    let script_path = job_dir.join("script.ps1");
    let stdout_path = job_dir.join("stdout.txt");
    let stderr_path = job_dir.join("stderr.txt");
    write_utf8_bom(&script_path, &format!("{POWERSHELL_PREFIX}\n{script}"))?;

    let stdout_file = File::create(&stdout_path).map_err(|error| error.to_string())?;
    let stderr_file = File::create(&stderr_path).map_err(|error| error.to_string())?;
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("PowerShell 启动失败：{error}"))?;

    let status = match child
        .wait_timeout(timeout)
        .map_err(|error| error.to_string())?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_dir_all(&job_dir);
            return Err("PowerShell 操作超时，已安全终止".to_string());
        }
    };
    let stdout = read_utf8(&stdout_path);
    let stderr = read_utf8(&stderr_path);
    let _ = fs::remove_dir_all(&job_dir);
    if !status.success() {
        return Err(if stderr.is_empty() {
            format!("PowerShell 返回退出码 {}", status.code().unwrap_or(-1))
        } else {
            stderr
        });
    }
    Ok(stdout)
}

pub fn run_elevated(data_dir: &Path, body: &str, timeout: Duration) -> Result<Vec<String>, String> {
    let job_dir = data_dir.join("jobs").join(Uuid::new_v4().to_string());
    fs::create_dir_all(&job_dir).map_err(|error| format!("创建管理员任务失败：{error}"))?;
    let script_path = job_dir.join("action.ps1");
    let result_path = job_dir.join("result.json");
    let result_literal = escape_single_quoted(&result_path.to_string_lossy());
    let wrapped = format!(
        r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$logs = [System.Collections.Generic.List[string]]::new()
function Add-Log([string]$message) {{ $logs.Add($message) }}
try {{
{body}
  [ordered]@{{ success = $true; logs = @($logs); error = $null }} |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '{result_literal}' -Encoding UTF8
}} catch {{
  [ordered]@{{ success = $false; logs = @($logs); error = $_.Exception.Message }} |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '{result_literal}' -Encoding UTF8
  exit 1
}}
"#
    );
    write_utf8_bom(&script_path, &wrapped)?;
    let script_literal = escape_single_quoted(&script_path.to_string_lossy());
    let launcher = format!(
        r#"
$scriptPath = '{script_literal}'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
exit $process.ExitCode
"#
    );
    if let Err(error) = run_powershell(data_dir, &launcher, timeout)
        && !result_path.exists()
    {
        let _ = fs::remove_dir_all(&job_dir);
        return Err(format!("管理员授权被取消或操作未能启动：{error}"));
    }
    let raw = fs::read_to_string(&result_path)
        .map_err(|error| format!("管理员操作没有返回结果：{error}"))?;
    let result: ElevatedResult = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("管理员操作结果无效：{error}"))?;
    let _ = fs::remove_dir_all(&job_dir);
    if !result.success {
        return Err(result.error.unwrap_or_else(|| "管理员操作失败".to_string()));
    }
    Ok(result.logs)
}

pub fn is_admin(data_dir: &Path) -> bool {
    run_powershell(
        data_dir,
        r#"[Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent() |
ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }"#,
        Duration::from_secs(10),
    )
    .is_ok_and(|value| value == "True")
}
