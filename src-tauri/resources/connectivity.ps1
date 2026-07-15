Add-Type -AssemblyName System.Net.Http
$proxyEndpoint = '__PROXY_ENDPOINT__'
$results = [System.Collections.Generic.List[object]]::new()

function Add-Result([string]$name, [string]$target, [bool]$ok, [long]$latency, [string]$detail) {
  $results.Add([ordered]@{
    name = $name
    target = $target
    ok = $ok
    latencyMs = $latency
    detail = $detail
  })
}

function Test-Http([string]$name, [string]$target, [string]$proxy) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $handler = [System.Net.Http.HttpClientHandler]::new()
  if ($proxy) {
    $handler.UseProxy = $true
    $handler.Proxy = [System.Net.WebProxy]::new($proxy)
  } else {
    $handler.UseProxy = $false
  }
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(7)
  try {
    $response = $client.GetAsync($target).GetAwaiter().GetResult()
    $code = [int]$response.StatusCode
    Add-Result $name $target ($code -gt 0 -and $code -lt 500) $watch.ElapsedMilliseconds ("HTTP {0}" -f $code)
    $response.Dispose()
  } catch {
    Add-Result $name $target $false $watch.ElapsedMilliseconds $_.Exception.GetBaseException().Message
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

Test-Http '国内直连' 'https://www.baidu.com/' ''
Test-Http 'Windows 联网探测' 'http://www.msftconnecttest.com/connecttest.txt' ''

if ($proxyEndpoint) {
  $uri = [Uri]$proxyEndpoint
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $pending = $client.BeginConnect($uri.Host, $uri.Port, $null, $null)
    if (!$pending.AsyncWaitHandle.WaitOne(2500)) { throw '连接超时' }
    $client.EndConnect($pending)
    Add-Result '本地代理端口' ($uri.Host + ':' + $uri.Port) $true $watch.ElapsedMilliseconds '端口正在监听'
  } catch {
    Add-Result '本地代理端口' ($uri.Host + ':' + $uri.Port) $false $watch.ElapsedMilliseconds $_.Exception.GetBaseException().Message
  } finally {
    $client.Dispose()
  }
  Test-Http '代理出口（ChatGPT）' 'https://chatgpt.com/' $proxyEndpoint
}

ConvertTo-Json -InputObject @($results) -Depth 6 -Compress
