param(
  [switch]$AppMode
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  $fallback = Join-Path $env:TEMP 'account-node22\node-v22.23.3-win-x64'
  if (Test-Path (Join-Path $fallback 'node.exe')) {
    $env:PATH = "$fallback;$env:PATH"
  } else {
    Write-Error 'Khong tim thay Node.js 22+. Hay cai dat Node.js >= 22 roi chay lai.'
    exit 1
  }
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host 'Dang cai dat thu vien...'
  npm ci
}

$port = if ($env:IG_TOOL_PORT) { $env:IG_TOOL_PORT } else { '4312' }
$url = "http://127.0.0.1:$port/#tao-ig"

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server\.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

$openWindow = {
  param($targetUrl, $useAppMode, $targetPort)
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $tcp = New-Object System.Net.Sockets.TcpClient
      $tcp.Connect('127.0.0.1', [int]$targetPort)
      $tcp.Close()
      break
    } catch {
      Start-Sleep -Milliseconds 150
    }
  }
  if ($useAppMode) {
    $candidates = @(
      "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "$env:ProgramFiles (x86)\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $browserExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($browserExe) {
      Start-Process $browserExe -ArgumentList "--app=$targetUrl", "--new-window", "--window-size=620,800", "--window-position=560,20"
      return
    }
  }
  Start-Process $targetUrl
}

Write-Host "Dang khoi dong IG Tool tai $url"
Write-Host "Dong cua so nay hoac bam Ctrl+C de tat hoan toan tool."
Start-Job -ScriptBlock $openWindow -ArgumentList $url, $AppMode.IsPresent, $port | Out-Null

node server.cjs
