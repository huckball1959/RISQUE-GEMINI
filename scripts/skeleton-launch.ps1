#Requires -Version 5.1
<#
.SYNOPSIS
  Fetches the latest files from RISQUE-GEMINI /scripts on GitHub into a local folder (default: Downloads).

.DESCRIPTION
  Uses the public GitHub Contents API (no token) to list whatever is currently in the repo's scripts/
  directory, then downloads each file. When new batch/PS1 files are added on GitHub, re-run this
  script to pull them without editing a file list.

  Anonymous API rate limit is modest (~60 listing requests/hour per IP). Typical use is one run.

.PARAMETER Dest
  Folder to write files into. If omitted: uses env RISQUE_SCRIPT_SYNC_DEST if set, else
  $env:USERPROFILE\Downloads\RISQUE-GEMINI-scripts

.PARAMETER Branch
  Git branch to read from. Default: main

.PARAMETER WhatIf
  List files that would be downloaded without writing.
#>
param(
  [string] $Dest,
  [string] $Branch = "main",
  [switch] $WhatIf,
  [switch] $OpenFolder
)

$ErrorActionPreference = "Stop"

# TLS for older Windows / PS 5.1 defaults
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

$Owner = "huckball1959"
$Repo  = "RISQUE-GEMINI"
$ApiPath = "https://api.github.com/repos/$Owner/$Repo/contents/scripts?ref=$Branch"

if (-not $PSBoundParameters.ContainsKey("Dest") -or [string]::IsNullOrWhiteSpace($Dest)) {
  if (-not [string]::IsNullOrWhiteSpace($env:RISQUE_SCRIPT_SYNC_DEST)) {
    $Dest = $env:RISQUE_SCRIPT_SYNC_DEST
  }
}
if ([string]::IsNullOrWhiteSpace($Dest)) {
  $Dest = Join-Path $env:USERPROFILE "Downloads\RISQUE-GEMINI-scripts"
}

$Dest = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Dest)
if (-not $WhatIf) {
  if (-not (Test-Path -LiteralPath $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  }
}

$ua = "RISQUE-GEMINI-skeleton-launch/1.0 (public repo sync; contact: repo owner)"
Write-Host "RISQUE-GEMINI script sync" -ForegroundColor Cyan
Write-Host "  Branch: $Branch"
Write-Host "  API:    $ApiPath"
Write-Host "  Dest:   $Dest"
Write-Host ""

$headers = @{ "User-Agent" = $ua; "Accept" = "application/vnd.github+json" }

try {
  $items = Invoke-RestMethod -Uri $ApiPath -Headers $headers -Method Get
} catch {
  Write-Error "GitHub API request failed (network, rate limit, or repo path). $($_.Exception.Message)"
  exit 1
}

if (-not ($items -is [System.Array])) {
  Write-Error "Unexpected API response (expected a directory listing array)."
  exit 1
}

$files = @($items | Where-Object { $_.type -eq "file" -and $_.download_url })
if ($files.Count -eq 0) {
  Write-Error "No files returned under scripts/ - check branch name and repo visibility."
  exit 1
}

# Update other files first, then skeleton-launch.* so this script can replace itself last if run from Dest.
$ordered = @(
  $files | Where-Object { $_.name -notlike "skeleton-launch.*" } | Sort-Object name
) + @(
  $files | Where-Object { $_.name -like "skeleton-launch.*" } | Sort-Object name
)

$ok = 0
foreach ($f in $ordered) {
  $name = [string]$f.name
  $url = [string]$f.download_url
  if ([string]::IsNullOrWhiteSpace($name) -or [string]::IsNullOrWhiteSpace($url)) { continue }
  $target = Join-Path $Dest $name
  if ($WhatIf) {
    Write-Host "  [WhatIf] $name -> $target"
    $ok++
    continue
  }
  Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -Headers @{ "User-Agent" = $ua }
  $ok++
  Write-Host "  OK  $name"
}

Write-Host ""
if ($WhatIf) {
  Write-Host "WhatIf: $ok file(s) would be downloaded." -ForegroundColor Green
} else {
  Write-Host "Downloaded $ok file(s)." -ForegroundColor Green
}
Write-Host "Next: open that folder and run RISQUE.bat, or re-run with -OpenFolder." -ForegroundColor Yellow

if ($OpenFolder -and -not $WhatIf) {
  Start-Process explorer.exe $Dest
}

exit 0
