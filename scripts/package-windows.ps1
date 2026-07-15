$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = [string]$manifest.version
$releaseDirectory = Join-Path $root 'release'

Push-Location $root
try {
  # This workstation intermittently crashes rustc during parallel optimized builds.
  # Serial compilation is slower on a clean cache but makes local packaging deterministic.
  $env:CARGO_BUILD_JOBS = '1'
  corepack pnpm tauri build --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE" }

  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  $binary = Join-Path $root 'src-tauri\target\release\network-first-aid.exe'
  if (!(Test-Path -LiteralPath $binary)) { throw "Portable binary was not produced: $binary" }
  Copy-Item -LiteralPath $binary -Destination (Join-Path $releaseDirectory "Network-First-Aid-Portable-$version-x64.exe") -Force

  $installer = Get-ChildItem -LiteralPath (Join-Path $root 'src-tauri\target\release\bundle\nsis') -Filter '*.exe' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (!$installer) { throw 'NSIS installer was not produced' }
  Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDirectory "Network-First-Aid-Setup-$version-x64.exe") -Force
} finally {
  Pop-Location
}
