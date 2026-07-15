Add-Type -AssemblyName System.Net.Http

$settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
$proxyEndpoint = ''
if ([int]$settings.ProxyEnable -eq 1 -and $settings.ProxyServer) {
  foreach ($entry in ([string]$settings.ProxyServer -split ';')) {
    $candidate = $entry.Trim()
    if ($candidate.Contains('=')) {
      $parts = $candidate.Split('=', 2)
      if ($parts[0] -notin @('http', 'https')) { continue }
      $candidate = $parts[1]
    }
    if ($candidate -notmatch '^https?://') { $candidate = 'http://' + $candidate }
    try {
      $uri = [Uri]$candidate
      if ($uri.Host -in @('127.0.0.1', 'localhost') -and $uri.Port -gt 0) {
        $proxyEndpoint = $uri.AbsoluteUri
        break
      }
    } catch {}
  }
}

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $true
if ($proxyEndpoint) {
  $handler.UseProxy = $true
  $handler.Proxy = [System.Net.WebProxy]::new($proxyEndpoint)
} else {
  $handler.UseProxy = $false
}
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(12)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('Network-First-Aid/0.1.1')
try {
  $response = $client.GetAsync('https://github.com/soberbw-hash/network-first-aid/releases/latest').GetAwaiter().GetResult()
  $null = $response.EnsureSuccessStatusCode()
  $releaseUrl = $response.RequestMessage.RequestUri.AbsoluteUri
  if ($releaseUrl -notmatch '/releases/tag/(?<tag>[^/?#]+)') {
    throw 'GitHub 没有返回可识别的最新版本'
  }
  [ordered]@{
    tag_name = [Uri]::UnescapeDataString($Matches.tag)
    name = $null
    html_url = $releaseUrl
    draft = $false
    prerelease = $false
  } | ConvertTo-Json -Compress
} finally {
  if ($response) { $response.Dispose() }
  $client.Dispose()
  $handler.Dispose()
}
