#Requires -Version 5.1
<#
.SYNOPSIS
  Loopback HTTP API so file:// RISQUE host can write SAVE without File System Access picker.

.DESCRIPTION
  GET /api/health, POST /api/write|read|list|delete-files|delete-prefix|restart-browser.
  RISQUE.ps1 starts this in the background before opening Chromium when launching local file:// builds.

.PARAMETER SaveRoot
  Absolute save root (same as launcher $SaveRoot).
.PARAMETER Port
  Default 5599 (override with env RISQUE_DISK_PORT).
.PARAMETER Bind
  Default 127.0.0.1
#>
param(
    [Parameter(Mandatory = $true)][string]$SaveRoot,
    [int]$Port = $(if ($env:RISQUE_DISK_PORT) { [int]$env:RISQUE_DISK_PORT } else { 5599 }),
    [string]$Bind = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$script:Root = [System.IO.Path]::GetFullPath($SaveRoot.Trim())

function Send-RisqueDiskJson {
    param(
        [Parameter(Mandatory = $true)] $Response,
        [Parameter(Mandatory = $true)] $Object,
        [int]$Code = 200
    )
    $json = ($Object | ConvertTo-Json -Compress -Depth 30)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.StatusCode = $Code
    $Response.ContentType = "application/json; charset=utf-8"
    [void]$Response.Headers.Add("Access-Control-Allow-Origin", "*")
    [void]$Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    [void]$Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    $Response.ContentLength64 = $bytes.LongLength
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.OutputStream.Close()
}

function Get-RisqueDiskSafeFullPath {
    param([string]$Rel)
    $norm = ($Rel -replace '/', [IO.Path]::DirectorySeparatorChar).Trim([IO.Path]::DirectorySeparatorChar)
    $parts = @($norm.Split([IO.Path]::DirectorySeparatorChar) | Where-Object { $_ -and $_ -ne '.' })
    if ($parts -contains '..') {
        throw "invalid path"
    }
    $full = $script:Root
    foreach ($p in $parts) {
        $full = Join-Path $full $p
    }
    $full = [System.IO.Path]::GetFullPath($full)
    $rn = [System.IO.Path]::GetFullPath($script:Root)
    if (-not ($full.Equals($rn, [StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($rn + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))) {
        throw "path outside save root"
    }
    return $full
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://${Bind}:${Port}/"
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
}
catch {
    [Console]::Error.WriteLine("risque-disk-server.ps1: bind failed ${prefix}: $($_.Exception.Message)")
    exit 1
}

[Console]::Error.WriteLine("risque-disk-server.ps1 saveRoot=$script:Root listen=$prefix")

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    }
    catch {
        break
    }

    $req = $ctx.Request
    $res = $ctx.Response
    $apath = (($req.Url.AbsolutePath + "").TrimEnd('/')).ToLowerInvariant()

    try {
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 204
            [void]$res.Headers.Add("Access-Control-Allow-Origin", "*")
            [void]$res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            [void]$res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
            $res.OutputStream.Close()
            continue
        }

        if ($req.HttpMethod -eq "GET" -and $apath -eq "/api/health") {
            Send-RisqueDiskJson -Response $res -Object @{
                ok                     = $true
                saveRoot               = $script:Root
                supportsRestartBrowser = $true
                diskServerApiVersion   = 2
            }
            continue
        }

        if ($req.HttpMethod -ne "POST") {
            Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "method" } -Code 405
            continue
        }

        $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
        $body = @{}
        if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
            try {
                $body = $bodyText | ConvertFrom-Json
            }
            catch {
                $body = @{}
            }
        }

        if ($apath -eq "/api/write") {
            $rel = [string]$body.path
            $content = $body.content
            if ($null -eq $content) { $content = "" }
            if ($content -isnot [string]) {
                $content = ($content | ConvertTo-Json -Depth 100 -Compress)
            }
            $full = Get-RisqueDiskSafeFullPath -Rel $rel
            $dir = Split-Path -Parent $full
            if (-not (Test-Path -LiteralPath $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
            $utf8NoBom = New-Object System.Text.UTF8Encoding $false
            [System.IO.File]::WriteAllText($full, [string]$content, $utf8NoBom)
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; path = $rel }
            continue
        }

        if ($apath -eq "/api/read") {
            $rel = [string]$body.path
            $full = Get-RisqueDiskSafeFullPath -Rel $rel
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "not found" } -Code 404
                continue
            }
            $txt = [System.IO.File]::ReadAllText($full, [System.Text.Encoding]::UTF8)
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; content = $txt }
            continue
        }

        if ($apath -eq "/api/list") {
            $rel = [string]$body.dir
            $rel = ($rel -replace '\\', '/').Trim('/')
            $full = if ($rel) { Get-RisqueDiskSafeFullPath -Rel $rel } else { $script:Root }
            if (-not (Test-Path -LiteralPath $full -PathType Container)) {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $true; entries = @() }
                continue
            }
            $entries = New-Object System.Collections.ArrayList
            Get-ChildItem -LiteralPath $full -Force | Sort-Object Name | ForEach-Object {
                $kind = if ($_.PSIsContainer) { "directory" } else { "file" }
                $row = [ordered]@{ name = $_.Name; kind = $kind }
                if (-not $_.PSIsContainer) {
                    $row.mtimeMs = [int64](([DateTimeOffset]$_.LastWriteTimeUtc).ToUnixTimeMilliseconds())
                }
                [void]$entries.Add([hashtable]$row)
            }
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; entries = @($entries.ToArray()) }
            continue
        }

        if ($apath -eq "/api/delete-files") {
            $paths = $body.paths
            $removed = 0
            if ($paths -is [System.Array]) {
                foreach ($p in $paths) {
                    try {
                        $full = Get-RisqueDiskSafeFullPath -Rel ([string]$p)
                        if (Test-Path -LiteralPath $full -PathType Leaf) {
                            Remove-Item -LiteralPath $full -Force
                            $removed++
                        }
                    }
                    catch {
                    }
                }
            }
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; removed = $removed }
            continue
        }

        if ($apath -eq "/api/delete-prefix") {
            $relDir = [string]$body.dir
            $pfx = [string]$body.prefix
            if (-not $relDir -or -not $pfx) {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "dir and prefix required" } -Code 400
                continue
            }
            $dfull = Get-RisqueDiskSafeFullPath -Rel $relDir
            $removed = 0
            if (Test-Path -LiteralPath $dfull -PathType Container) {
                Get-ChildItem -LiteralPath $dfull -File -Force |
                    Where-Object { $_.Name.StartsWith($pfx, [StringComparison]::Ordinal) } |
                    ForEach-Object {
                        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
                        $removed++
                    }
            }
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; removed = $removed }
            continue
        }

        if ($apath -eq "/api/restart-browser") {
            $confirm = [string]$body.confirm
            if ($confirm -ne "risque-restart") {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "confirm" } -Code 400
                continue
            }
            $jobScript = Join-Path $PSScriptRoot "risque-browser-restart-job.ps1"
            if (-not (Test-Path -LiteralPath $jobScript)) {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "missing risque-browser-restart-job.ps1" } -Code 500
                continue
            }
            try {
                $spawnArgs = @(
                    "-NoProfile",
                    "-WindowStyle", "Hidden",
                    "-ExecutionPolicy", "Bypass",
                    "-File", $jobScript,
                    "-SaveRoot", $script:Root
                )
                Start-Process -FilePath "powershell.exe" -ArgumentList $spawnArgs -WindowStyle Hidden | Out-Null
            }
            catch {
                Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = $_.Exception.Message } -Code 500
                continue
            }
            Send-RisqueDiskJson -Response $res -Object @{ ok = $true; spawned = $true }
            continue
        }

        Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = "not found" } -Code 404
    }
    catch {
        try {
            Send-RisqueDiskJson -Response $res -Object @{ ok = $false; error = $_.Exception.Message } -Code 400
        }
        catch {
        }
    }
}
