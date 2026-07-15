$internetSettings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    description = [string]$_.InterfaceDescription
    status = [string]$_.Status
    linkSpeed = [string]$_.LinkSpeed
    macAddress = [string]$_.MacAddress
    interfaceIndex = [int]$_.ifIndex
    hardwareInterface = [bool]$_.HardwareInterface
  }
})
$dns = @(Get-DnsClientServerAddress -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    addressFamily = [int]$_.AddressFamily
    serverAddresses = @($_.ServerAddresses | ForEach-Object { [string]$_ })
  }
})
$routeMapper = {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    destinationPrefix = [string]$_.DestinationPrefix
    nextHop = [string]$_.NextHop
    routeMetric = [int]$_.RouteMetric
    interfaceMetric = [int]$_.InterfaceMetric
    policyStore = [string]$_.PolicyStore
  }
}
$allRoutes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object $routeMapper)
$defaultRoutes = @($allRoutes | Where-Object { $_.destinationPrefix -eq '0.0.0.0/0' })
$proxyProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan'
} | ForEach-Object {
  $processPath = $null
  try { $processPath = [string]$_.Path } catch {}
  [ordered]@{ name = [string]$_.ProcessName; id = [int]$_.Id; path = $processPath }
})
$proxyServices = @(Get-Service -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan' -or
  $_.DisplayName -match 'clash|mihomo|xsus|sing-box|v2ray|xray|wireguard|openvpn|tailscale|shadowsocks|trojan'
} | ForEach-Object {
  [ordered]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; status = [string]$_.Status; startType = [string]$_.StartType }
})
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{ localAddress = [string]$_.LocalAddress; localPort = [int]$_.LocalPort; owningProcess = [int]$_.OwningProcess }
})
$ipConfigurations = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    interfaceAlias = [string]$_.InterfaceAlias
    interfaceIndex = [int]$_.InterfaceIndex
    ipv4Address = @($_.IPv4Address | ForEach-Object { [string]$_.IPAddress })
    ipv4DefaultGateway = @($_.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop })
    netProfileName = if ($_.NetProfile) { [string]$_.NetProfile.Name } else { '' }
  }
})
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$hostsLines = @()
$hostsHash = ''
if (Test-Path -LiteralPath $hostsPath) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($hostsPath)
  try { $hostsHash = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
  finally { $stream.Dispose(); $sha256.Dispose() }
  $hostsLines = @(Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue | Where-Object {
    $line = $_.Trim()
    $line -and -not $line.StartsWith('#')
  } | ForEach-Object { [string]$_ })
}
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object {
  [ordered]@{
    name = [string]$_.Name
    interfaceAlias = [string]$_.InterfaceAlias
    networkCategory = [string]$_.NetworkCategory
    ipv4Connectivity = [string]$_.IPv4Connectivity
  }
})
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
[ordered]@{
  capturedAt = [DateTime]::UtcNow.ToString('o')
  computerName = [string]$env:COMPUTERNAME
  windowsVersion = if ($os) { [string]($os.Caption + ' ' + $os.Version + ' build ' + $os.BuildNumber) } else { [Environment]::OSVersion.VersionString }
  proxy = [ordered]@{
    enabled = ([int]$internetSettings.ProxyEnable -eq 1)
    server = [string]$internetSettings.ProxyServer
    override = [string]$internetSettings.ProxyOverride
    autoConfigUrl = [string]$internetSettings.AutoConfigURL
    autoDetect = ([int]$internetSettings.AutoDetect -eq 1)
  }
  winHttpProxy = [string](netsh winhttp show proxy | Out-String).Trim()
  adapters = $adapters
  dns = $dns
  defaultRoutes = $defaultRoutes
  allRoutes = $allRoutes
  proxyProcesses = $proxyProcesses
  proxyServices = $proxyServices
  listeners = $listeners
  ipConfigurations = $ipConfigurations
  hostsHash = $hostsHash
  hostsEntries = $hostsLines
  networkProfiles = $profiles
} | ConvertTo-Json -Depth 12 -Compress
