$snapshotPath = '__SNAPSHOT_PATH__'
$hostsBackupPath = '__HOSTS_PATH__'
$firewallBackupPath = '__FIREWALL_PATH__'
$scopes = @(__SCOPES__)
$stored = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json

if ($scopes -contains 'proxy') {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  $proxy = $stored.raw.proxy
  Set-ItemProperty -LiteralPath $key -Name ProxyEnable -Type DWord -Value $(if ($proxy.enabled) { 1 } else { 0 })
  foreach ($pair in @(@('ProxyServer', [string]$proxy.server), @('ProxyOverride', [string]$proxy.override), @('AutoConfigURL', [string]$proxy.autoConfigUrl))) {
    if ($pair[1]) { Set-ItemProperty -LiteralPath $key -Name $pair[0] -Type String -Value $pair[1] }
    else { Remove-ItemProperty -LiteralPath $key -Name $pair[0] -ErrorAction SilentlyContinue }
  }
  Set-ItemProperty -LiteralPath $key -Name AutoDetect -Type DWord -Value $(if ($proxy.autoDetect) { 1 } else { 0 })
  Add-Log '用户代理设置已还原'
}

if ($scopes -contains 'dns') {
  $restored = 0
  foreach ($entry in @($stored.raw.dns | Where-Object { [int]$_.addressFamily -eq 2 })) {
    $adapter = Get-NetAdapter -InterfaceIndex ([int]$entry.interfaceIndex) -ErrorAction SilentlyContinue
    if (!$adapter) { continue }
    $servers = @($entry.serverAddresses | ForEach-Object { [string]$_ })
    if ($servers.Count -eq 0) { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses }
    else { Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $servers }
    $restored++
  }
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  Add-Log ("已还原 {0} 个网卡的 DNS" -f $restored)
}

if ($scopes -contains 'hosts') {
  if (!(Test-Path -LiteralPath $hostsBackupPath)) { throw '此快照没有可用的 Hosts 备份' }
  Copy-Item -LiteralPath $hostsBackupPath -Destination (Join-Path $env:SystemRoot 'System32\drivers\etc\hosts') -Force
  Clear-DnsClientCache -ErrorAction SilentlyContinue
  Add-Log 'Hosts 文件已还原'
}

if ($scopes -contains 'firewall') {
  if (!(Test-Path -LiteralPath $firewallBackupPath)) { throw '此快照没有防火墙策略文件' }
  netsh advfirewall import $firewallBackupPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '防火墙策略还原失败' }
  Add-Log '防火墙策略已还原'
}
