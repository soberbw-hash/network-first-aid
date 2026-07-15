use std::{path::Path, time::Duration};

use crate::{models::LatestRelease, powershell::run_powershell};

const UPDATE_SCRIPT: &str = include_str!("../resources/update.ps1");
const RELEASE_PREFIX: &str = "https://github.com/soberbw-hash/network-first-aid/releases/tag/";

pub fn latest_release(data_dir: &Path) -> Result<LatestRelease, String> {
    let output =
        run_powershell(data_dir, UPDATE_SCRIPT, Duration::from_secs(20)).map_err(|error| {
            if error.contains("403") || error.to_ascii_lowercase().contains("rate limit") {
                "GitHub 暂时限制了当前代理出口，请稍后再试".to_string()
            } else {
                "更新检查失败，请确认代理可访问 GitHub 后重试".to_string()
            }
        })?;
    let release: LatestRelease =
        serde_json::from_str(&output).map_err(|error| format!("版本信息解析失败：{error}"))?;
    if release.draft
        || release.prerelease
        || !release.html_url.starts_with(RELEASE_PREFIX)
        || release.tag_name.trim().is_empty()
    {
        return Err("GitHub 返回的版本信息不受信任".to_string());
    }
    Ok(release)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_pages_are_restricted_to_the_official_repository() {
        assert!(
            "https://github.com/soberbw-hash/network-first-aid/releases/tag/v0.1.1"
                .starts_with(RELEASE_PREFIX)
        );
        assert!(
            !"https://github.com/other/network-first-aid/releases/tag/v9"
                .starts_with(RELEASE_PREFIX)
        );
    }

    #[test]
    #[ignore = "manual smoke test: follows the official GitHub latest-release redirect"]
    fn reads_the_current_release_through_windows_networking() {
        let directory =
            std::env::temp_dir().join(format!("network-first-aid-{}", uuid::Uuid::new_v4()));
        let release = latest_release(&directory).expect("GitHub release check should complete");
        assert!(release.html_url.starts_with(RELEASE_PREFIX));
        println!("latest release: {}", release.tag_name);
        let _ = std::fs::remove_dir_all(directory);
    }
}
