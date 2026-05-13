#Requires -Version 5.1
<#
.SYNOPSIS
  RISQUE-GEMINI launcher — flat save folder, Chromium download path, then Local vs hosted GEMINI; dual displays by default.

.DESCRIPTION
 - Ensures the save folder exists (default C:\risque\save, or RISQUE_DOWNLOAD_PATH).
 - Local launch only: starts a tiny loopback save API (risque-disk-server.ps1 on 127.0.0.1, default port 5599) so the game writes DD.json / rNpM*.json into the save root with zero browser folder picks. Hosted launch skips the API.
 - Sets Chromium default download directory to that folder (JSON downloads land there; browser profile lives under %TEMP%).
 - Writes risque-launcher-paths.json beside the repo (gitignored) for path hints.
 - Asks: local (this clone) or hosted GEMINI (GitHub Pages), then opens host on the primary display (work area size, tabs visible) and
    public TV on the secondary (Win32 move + F11). Single-window mode is opt-in (-SingleWindow).

  Local clone uses file:// for pages; a separate minimal HTTP listener on localhost is used only for save/replay JSON (not for serving the game).

  Double-click: RISQUE.bat in repo root — runs this script.

.PARAMETER SkipMenu
  Do not show the menu; launch local unless -Hosted / -File.

.PARAMETER Menu
  Deprecated (menu is now default). Ignored.

.PARAMETER Hosted
  Open hosted build instead of local clone (skips menu).

.PARAMETER HostedUrl
  Override URL when using -Hosted (index.html or game.html; default is GEMINI game.html with login flow).

.PARAMETER File
  Legacy alias for local file:// launch (same as default).

.PARAMETER SingleWindow
  One browser window only (no dual-monitor flow).

.PARAMETER NoEmergencyWatcher
    Legacy; ignored (no launcher-side background watchers).

.PARAMETER NoReplayDebug
    Local file:// only: do not append replayDebug=1 (skips console [ReplayDebug] tape logging). Default is ON for local launches so scripts\RISQUE.bat needs no extra clicks.

.PARAMETER PrepareEnvOnly
    Local or hosted: ensure save folder, disk helper (local only), and risque-launcher-paths.json — then exit without opening a browser. For perf/automation (e.g. Playwright) that loads file:// or http pages itself.

.NOTES
  Dual-monitor Chromium uses a temp user-data-dir, download directory forced to the save root via Preferences.
  Env RISQUE_BROWSER = auto | chrome | edge (default auto). Local disk URLs use file:///C:/path/... shape.
#>
param(
    [switch]$SkipMenu,
    [switch]$Menu,
    [switch]$Hosted,
    [string]$HostedUrl = "",
    [switch]$File,
    [switch]$SingleWindow,
    [switch]$NoEmergencyWatcher,
    [switch]$NoReplayDebug,
    [switch]$PrepareEnvOnly
)

$ErrorActionPreference = "Stop"

if ($PrepareEnvOnly) {
    $SkipMenu = $true
}

$DefaultHostedUrl = "https://huckball1959.github.io/RISQUE-GEMINI/game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html"

$SaveRoot = if ([string]::IsNullOrWhiteSpace($env:RISQUE_DOWNLOAD_PATH)) {
    "C:\risque\save"
} else {
    $env:RISQUE_DOWNLOAD_PATH.Trim()
}

function Get-RisqueSaveRootOrParentIfBranch {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    try {
        $full = [System.IO.Path]::GetFullPath($Path.Trim())
    }
    catch {
        return $Path
    }
    $leaf = [System.IO.Path]::GetFileName($full.TrimEnd('\', '/'))
    # Do not include SAVE/save here: the default flat root is C:\risque\save and must stay that path.
    foreach ($b in @('GAME', 'REPLAY', 'STAGING', 'archive', 'EMERGENCY', 'LOGS')) {
        if ($leaf.Equals($b, [StringComparison]::OrdinalIgnoreCase)) {
            $parent = [System.IO.Path]::GetDirectoryName($full)
            Write-Warning "Save path must be the SAVE root, not \${b}. Using: $parent"
            return $parent
        }
    }
    return $full
}
$SaveRoot = Get-RisqueSaveRootOrParentIfBranch -Path $SaveRoot

$ScriptDir = $PSScriptRoot
$BrowserProfileHost = Join-Path $env:TEMP "risque-browser-profiles\host"
$BrowserProfilePublic = Join-Path $env:TEMP "risque-browser-profiles\public"
$RepoRoot = Split-Path -Parent $ScriptDir

# Chromium/Edge command line marker so risque-browser-restart-job.ps1 can kill only RISQUE-launched windows.
$Global:RisqueLauncherInstanceFlag = "--risque-launcher-instance=risque-gemini-local"
# Round-boundary browser restart is off by default (lean session). Set RISQUE_PERIODIC_RESTART_ROUNDS=N (N>0) to re-enable.
$PeriodicBrowserRestartRounds = 0
if ($null -ne $env:RISQUE_PERIODIC_RESTART_ROUNDS -and "${env:RISQUE_PERIODIC_RESTART_ROUNDS}".Trim() -match '^(\d+)$') {
    $PeriodicBrowserRestartRounds = [int]$Matches[1]
}

function Write-RisqueLauncherPaths {
    param(
        [string]$GameDir,
        [string]$DiskApiBase = "",
        [int]$PeriodicBrowserRestartEveryRounds = 0
    )
    $payload = [ordered]@{
        saveRoot               = $SaveRoot
        gameDir                = $GameDir
        replayDir              = $SaveRoot
        stagingDir             = $SaveRoot
        emergencyDir           = $SaveRoot
        gameSubdir             = $SaveRoot
        logsDir                = $SaveRoot
        emergencyWatcherLog    = Join-Path $SaveRoot "risque-emergency-watcher.log"
        profileHost            = $BrowserProfileHost
        profilePublic          = $BrowserProfilePublic
        activeSessionStamp     = ""
        activeSessionGameDir   = $SaveRoot
        activeSessionReplayDir = $SaveRoot
        archiveDir             = $SaveRoot
        archiveShortcut        = ""
        diskApiBase            = $DiskApiBase
        periodicBrowserRestartEveryRounds = $PeriodicBrowserRestartEveryRounds
        generatedAtUtc         = (Get-Date).ToUniversalTime().ToString("o")
        psVersion              = $PSVersionTable.PSVersion.ToString()
    }
    $json = $payload | ConvertTo-Json -Depth 4
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    $repoCopy = Join-Path $RepoRoot "risque-launcher-paths.json"
    try {
        [System.IO.File]::WriteAllText($repoCopy, $json, $utf8NoBom)
        Write-Host "Wrote launcher paths (repo only): $repoCopy" -ForegroundColor DarkGray
    }
    catch {
        Write-Warning "Could not write $repoCopy"
    }
}

function Write-RisqueBrowserResumeRestartContext {
    param(
        [Parameter(Mandatory = $true)][string]$SaveRootPath,
        [Parameter(Mandatory = $true)][string]$BatchPath,
        [Parameter(Mandatory = $true)][string]$BatWorkingDirectory
    )
    $ctx = [ordered]@{
        v                               = 1
        instanceFlag                    = $RisqueLauncherInstanceFlag
        delaySec                        = 3
        batchPath                       = [System.IO.Path]::GetFullPath($BatchPath)
        batchArgs                       = @("-SkipMenu")
        batchWorkingDirectory           = [System.IO.Path]::GetFullPath($BatWorkingDirectory)
        periodicBrowserRestartEveryRounds = $PeriodicBrowserRestartRounds
    }
    $outPath = Join-Path $SaveRootPath ".risque-launcher-resume-context.json"
    try {
        $json = $ctx | ConvertTo-Json -Depth 6
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($outPath, $json, $utf8NoBom)
        Write-Host "Wrote browser resume restart context: $outPath" -ForegroundColor DarkGray
    }
    catch {
        Write-Warning "Could not write restart context: $($_.Exception.Message)"
    }
}

function Stop-RisqueDiskListenerOnPort {
    param([int]$PortNum)
    try {
        $conns = @(Get-NetTCPConnection -LocalPort $PortNum -State Listen -ErrorAction SilentlyContinue)
        foreach ($c in $conns) {
            $op = $c.OwningProcess
            if ($op -and $op -gt 0) {
                Stop-Process -Id $op -Force -ErrorAction SilentlyContinue
            }
        }
    }
    catch {
        # ignore — port may be free or cmdlet unavailable
    }
    # OwningProcess is often empty without elevation; kill any shell still hosting risque-disk-server.ps1.
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                ($_.Name -eq "powershell.exe" -or $_.Name -eq "pwsh.exe") -and
                $_.CommandLine -and ($_.CommandLine -like "*risque-disk-server.ps1*")
            } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    catch {
    }
    Start-Sleep -Milliseconds 900
}

function Start-RisqueLocalDiskApi {
    # Starts one hidden HttpListener helper so game.js can POST replay/session JSON into the save folder (no picker).
    param(
        [Parameter(Mandatory = $true)][string]$SaveRootPath,
        [int]$Port
    )
    $base = "http://127.0.0.1:$Port"
    $alreadyCurrent = $false
    $hadListener = $false
    try {
        $resp = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) {
            $hadListener = $true
            try {
                $hj = $resp.Content | ConvertFrom-Json
                if ($null -ne $hj -and $hj.supportsRestartBrowser -eq $true) {
                    $alreadyCurrent = $true
                }
            }
            catch {
            }
        }
    }
    catch {
        # not listening
    }
    if ($alreadyCurrent) {
        Write-Host "Save helper already running: $base" -ForegroundColor DarkGray
        return $base
    }
    if ($hadListener) {
        Write-Warning "Stopping outdated save helper on port $Port (missing features); starting updated risque-disk-server.ps1."
    }
    $serverScript = Join-Path $ScriptDir "risque-disk-server.ps1"
    if (-not (Test-Path -LiteralPath $serverScript)) {
        Write-Warning ("Missing disk server script: {0} (keep repo scripts folder intact)." -f $serverScript)
        return ""
    }
    # Retry: stale listener often survives when TCP OwningProcess is unavailable; require supportsRestartBrowser in health.
    for ($spin = 1; $spin -le 3; $spin++) {
        if ($spin -gt 1) {
            Write-Warning "Save helper on $base did not report supportsRestartBrowser; recycling listener (attempt $spin/3)."
        }
        Stop-RisqueDiskListenerOnPort -PortNum $Port
        try {
            Start-Process -FilePath "powershell.exe" -ArgumentList @(
                "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
                "-File", $serverScript,
                "-SaveRoot", $SaveRootPath,
                "-Port", $Port
            ) -WindowStyle Hidden
        }
        catch {
            Write-Warning "Could not start save helper: $($_.Exception.Message)"
            return ""
        }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
            try {
                $r2 = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 1
                if ($r2.StatusCode -eq 200) {
                    try {
                        $hj2 = $r2.Content | ConvertFrom-Json
                        if ($null -ne $hj2 -and $hj2.supportsRestartBrowser -eq $true) {
                            Write-Host "Session files will save under: $SaveRootPath" -ForegroundColor Green
                            return $base
                        }
                    }
                    catch {
                    }
                }
            }
            catch {
            }
            Start-Sleep -Milliseconds 300
        }
    }
    Write-Warning "Save helper did not start or advertise restart-browser on $base . Replays stay in the browser until this works."
    return ""
}

function Write-RisqueRuntimeStatus {
    param(
        [Parameter(Mandatory = $true)][string]$SaveRootPath,
        [string]$DiskApiBase = "",
        [switch]$HostedMode
    )
    $saveWritable = $false
    try {
        if (-not (Test-Path -LiteralPath $SaveRootPath)) {
            New-Item -ItemType Directory -Path $SaveRootPath -Force | Out-Null
        }
        $probeFile = Join-Path $SaveRootPath ".risque-write-probe.tmp"
        [System.IO.File]::WriteAllText($probeFile, "ok")
        Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
        $saveWritable = $true
    }
    catch {
        $saveWritable = $false
    }

    $diskStatus = "INACTIVE"
    if (-not $HostedMode -and -not [string]::IsNullOrWhiteSpace($DiskApiBase)) {
        try {
            $h = Invoke-WebRequest -Uri ($DiskApiBase.TrimEnd('/') + "/api/health") -UseBasicParsing -TimeoutSec 2
            if ($h.StatusCode -eq 200) {
                $diskStatus = "ACTIVE"
            }
        }
        catch {
            $diskStatus = "INACTIVE"
        }
    }

    Write-Host ""
    Write-Host "Runtime status:" -ForegroundColor Cyan
    Write-Host "  Save root: $SaveRootPath"
    Write-Host ("  Save root writable: " + $(if ($saveWritable) { "YES" } else { "NO" })) -ForegroundColor $(if ($saveWritable) { "Green" } else { "Yellow" })
    if ($HostedMode) {
        Write-Host "  Local disk API: HOSTED MODE (browser-only folder permissions)" -ForegroundColor DarkYellow
    }
    else {
        Write-Host "  Local disk API: $diskStatus" -ForegroundColor $(if ($diskStatus -eq "ACTIVE") { "Green" } else { "Yellow" })
    }
    Write-Host "  Replay bootstrap handoff: LS + memory fallback (runtime managed)" -ForegroundColor DarkGray
    Write-Host ""
}

function Get-RisqueBrowserPath {
    $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $c1 = Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"
    $c2 = Join-Path ${env:ProgramFiles} "Google\Chrome\Application\chrome.exe"
    $e1 = Join-Path ${env:ProgramFiles} "Microsoft\Edge\Application\msedge.exe"
    $e2 = if ($pf86) { Join-Path $pf86 "Microsoft\Edge\Application\msedge.exe" } else { $null }
    foreach ($x in @($c1, $c2, $e1, $e2)) {
        if ($x -and (Test-Path -LiteralPath $x)) { return $x }
    }
    return $null
}

function ConvertTo-FileUri {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([System.Uri]::new((Resolve-Path -LiteralPath $Path).Path)).AbsoluteUri
}

function Get-RisquePublicTvUrlFromIndexUrl {
    param([string]$IndexUrl)
    if ([string]::IsNullOrWhiteSpace($IndexUrl)) { return "" }
    # file://: UriBuilder can emit game.html%3Fdisplay=public (broken in Chrome). Build with a literal ? .
    $trim = $IndexUrl.Trim()
    if ($trim -match '(?i)^file:') {
        $noHash = ($trim -split '#', 2)[0]
        $q = $noHash.IndexOf('?')
        if ($q -ge 0) { $noHash = $noHash.Substring(0, $q) }
        $lastSlash = $noHash.LastIndexOf('/')
        if ($lastSlash -lt 0) { return "" }
        return $noHash.Substring(0, $lastSlash) + '/game.html?display=public'
    }
    try {
        $u = [Uri]$trim
        $path = $u.AbsolutePath
        if ($path -match '(?i)index\.html$') {
            $path = $path -replace '(?i)index\.html$', 'game.html'
        }
        elseif ($path.EndsWith('/')) {
            if ($path.Length -le 1) { $path = "/game.html" } else { $path = $path + 'game.html' }
        }
        else {
            $path = ($path -replace '/[^/]+$', '/game.html')
        }
        $b = New-Object System.UriBuilder $u
        $b.Path = $path
        $b.Query = "display=public"
        return $b.Uri.AbsoluteUri
    }
    catch {
        $i = $IndexUrl.LastIndexOf('/')
        if ($i -ge 0) { return $IndexUrl.Substring(0, $i) + '/game.html?display=public' }
        return ""
    }
}

function Add-RisqueReplayDebugQuery {
    param(
        [Parameter(Mandatory)][string]$Url,
        [ValidateSet('1', '0')][string]$Value = '1'
    )
    if ([string]::IsNullOrWhiteSpace($Url)) { return $Url }
    if ($Url -match '[?&]replayDebug=') { return $Url }
    $sep = $(if ($Url -match '\?') { '&' } else { '?' })
    return $Url + $sep + 'replayDebug=' + $Value
}

function Get-RisqueLocalDiskHostPublicUrls {
    param(
        [Parameter(Mandatory)][string]$RepoRootPath,
        [switch]$ReplayDebug,
        [switch]$ReplayDebugOff
    )
    $unixRoot = $RepoRootPath.TrimEnd('\').Replace('\', '/')
    if ([string]::IsNullOrWhiteSpace($unixRoot)) {
        throw "Empty repo root for local file URLs."
    }
    # Host must be game.html (not index.html) so the <head> resume snippet runs on first paint after a
    # periodic browser restart; index.html only redirects here and would otherwise leave users on login.
    $hostLoginChain = "game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html"
    $hostU = "file:///$unixRoot/$hostLoginChain"
    $pubU = "file:///$unixRoot/game.html?display=public"
    if ($ReplayDebugOff) {
        $hostU = Add-RisqueReplayDebugQuery -Url $hostU -Value '0'
        $pubU = Add-RisqueReplayDebugQuery -Url $pubU -Value '0'
    }
    elseif ($ReplayDebug) {
        $hostU = Add-RisqueReplayDebugQuery -Url $hostU -Value '1'
        $pubU = Add-RisqueReplayDebugQuery -Url $pubU -Value '1'
    }
    return @{
        Host   = $hostU
        Public = $pubU
    }
}

function Set-RisqueChromiumDownloadDirectory {
    param(
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$DownloadDir
    )
    $defaultDir = Join-Path $ProfileDir "Default"
    $prefsPath = Join-Path $defaultDir "Preferences"
    New-Item -Path $defaultDir -ItemType Directory -Force | Out-Null
    $prefs = @{}
    if (Test-Path -LiteralPath $prefsPath) {
        try { $prefs = Get-Content -LiteralPath $prefsPath -Raw | ConvertFrom-Json -Depth 100 } catch { }
    }
    if (-not $prefs.savefile) { $prefs.savefile = @{} }
    if (-not $prefs.download) { $prefs.download = @{} }
    $prefs.savefile.default_directory = $DownloadDir
    $prefs.download.default_directory = $DownloadDir
    $prefs.download.prompt_for_download = $false
    $json = $prefs | ConvertTo-Json -Depth 100
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($prefsPath, $json, $utf8NoBom)
}

function Get-RisqueChromeExecutable {
    @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Get-RisqueEdgeExecutable {
    @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

function Invoke-RisqueDualMonitorBrowserLaunch {
    param(
        [Parameter(Mandatory)][string]$HostUrl,
        [Parameter(Mandatory)][string]$PublicUrl,
        [Parameter(Mandatory)][string]$DownloadPath,
        [Parameter(Mandatory)][string]$ScriptsDirectory,
        [string]$SessionStamp = ""
    )
    if ([string]::IsNullOrWhiteSpace($HostUrl) -or [string]::IsNullOrWhiteSpace($PublicUrl)) {
        throw "Dual launch requires host and public URLs."
    }
    $chromiumPs1 = Join-Path $ScriptsDirectory "risque-chromium-primary.ps1"
    if (-not (Test-Path -LiteralPath $chromiumPs1)) { throw "Missing $chromiumPs1" }
    . $chromiumPs1
    Add-Type -AssemblyName System.Windows.Forms

    $chromeExe = Get-RisqueChromeExecutable
    $edgeExe = Get-RisqueEdgeExecutable
    $browserWant = $env:RISQUE_BROWSER
    if ([string]::IsNullOrWhiteSpace($browserWant)) { $browserWant = "auto" }
    $browserWant = $browserWant.Trim().ToLower()
    if ($browserWant -eq "msedge") { $browserWant = "edge" }

    $browserExe = $null
    $profileDir = $null
    $browserLabel = ""

    switch ($browserWant) {
        "chrome" {
            if (-not $chromeExe) { throw "RISQUE_BROWSER=chrome but Google Chrome was not found." }
            $browserExe = $chromeExe
            $profileDir = Join-Path $env:TEMP "risque-host-chrome"
            $browserLabel = "Chrome"
        }
        "edge" {
            if (-not $edgeExe) { throw "RISQUE_BROWSER=edge but Microsoft Edge was not found." }
            $browserExe = $edgeExe
            $profileDir = Join-Path $env:TEMP "risque-host-edge"
            $browserLabel = "Edge"
        }
        Default {
            if ($chromeExe) {
                $browserExe = $chromeExe
                $profileDir = Join-Path $env:TEMP "risque-host-chrome"
                $browserLabel = "Chrome"
            }
            elseif ($edgeExe) {
                $browserExe = $edgeExe
                $profileDir = Join-Path $env:TEMP "risque-host-edge"
                $browserLabel = "Edge"
            }
            else {
                throw "Neither Chrome nor Edge found. Install one or set RISQUE_BROWSER."
            }
        }
    }

    Set-RisqueChromiumDownloadDirectory -ProfileDir $profileDir -DownloadDir $DownloadPath
    Write-Host "Default download directory set to $DownloadPath ($browserLabel profile: $profileDir)" -ForegroundColor Cyan

    try {
        $markerPath = Join-Path $env:TEMP "RISQUE-LAUNCHER-LAST-RUN.txt"
        $markerLines = @(
            "Last launcher run (local): $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
            "Browser: $browserLabel",
            "Host URL: $HostUrl",
            "Public URL: $PublicUrl",
            "Profile (user-data-dir): $profileDir",
            "Expected downloads/saves folder: $DownloadPath",
            'Flat layout - JSON files stay in this folder (DD.json, rNpM.json, checkpoints, etc.).',
            ""
        )
        $utf8Marker = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($markerPath, ($markerLines -join [Environment]::NewLine), $utf8Marker)
    }
    catch { }

    $primary = [System.Windows.Forms.Screen]::PrimaryScreen
    $secondary = $primary
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
        if ($s.DeviceName -ne $primary.DeviceName) {
            $secondary = $s
            break
        }
    }
    if ($secondary.DeviceName -eq $primary.DeviceName) {
        Write-Warning "Only one display detected - public window will open on top of the host."
    }
    $pRect = $primary.WorkingArea
    $sRect = $secondary.WorkingArea

    Write-Host ('Launching host with {0} on primary ({1}x{2})...' -f $browserLabel, $pRect.Width, $pRect.Height) -ForegroundColor Cyan
    $hostArgs = @(
        "--user-data-dir=`"$profileDir`"",
        "--new-window",
        $RisqueLauncherInstanceFlag,
        "--window-position=$($pRect.Left),$($pRect.Top)",
        "--window-size=$($pRect.Width),$($pRect.Height)",
        "--no-first-run",
        "`"$HostUrl`""
    )
    Start-Process -FilePath $browserExe -ArgumentList $hostArgs

    Start-Sleep -Seconds 5
    $beforePub = [ChromiumWindowHelper]::ListRootChromium().ToArray()

    Write-Host ('Launching public/TV with {0} on secondary ({1}x{2})...' -f $browserLabel, $sRect.Width, $sRect.Height) -ForegroundColor Cyan
    $pubArgs = @(
        "--user-data-dir=`"$profileDir`"",
        "--new-window",
        $RisqueLauncherInstanceFlag,
        "--window-position=$($sRect.Left),$($sRect.Top)",
        "--window-size=$($sRect.Width),$($sRect.Height)",
        "--no-first-run",
        "`"$PublicUrl`""
    )
    Start-Process -FilePath $browserExe -ArgumentList $pubArgs

    $pubHwnd = Wait-RisqueNewChromiumWindow -BeforeHandles $beforePub -TimeoutMs 20000
    if ($pubHwnd -eq [IntPtr]::Zero) {
        Write-Warning "Could not detect the new browser window handle - TV may stay on the wrong display."
    }
    else {
        Start-Sleep -Milliseconds 400
        Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
        Start-Sleep -Milliseconds 500
        Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
        Write-Host "Moved public window to secondary monitor (Win32)." -ForegroundColor Green
        try {
            Enter-RisqueChromiumF11Fullscreen -Handle $pubHwnd
            Write-Host "Public TV: F11 fullscreen (Esc exits fullscreen on the TV window)." -ForegroundColor DarkGray
        }
        catch {
            Write-Warning "Could not auto-send F11; press F11 on the TV window for fullscreen."
        }
    }

    Write-Host ""
    Write-Host "Dual-display launch complete. Saves: $DownloadPath  |  Browser: $browserLabel" -ForegroundColor Green
}

try {
    if (-not (Test-Path -LiteralPath $SaveRoot)) {
        New-Item -ItemType Directory -Path $SaveRoot -Force | Out-Null
    }
}
catch {
    Write-Host "ERROR: Could not create $SaveRoot - check permissions or RISQUE_DOWNLOAD_PATH." -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

$showMenu = (
    -not $SkipMenu -and
    -not $Hosted -and
    -not $File
)

if ($showMenu) {
    Write-Host ""
    Write-Host " RISQUE-GEMINI - which build?" -ForegroundColor Cyan
    Write-Host '  (Host opens on your main display; public TV on the second - fullscreen / positioned automatically.)'
    Write-Host ""
    Write-Host "  1  Local game  - this repo from disk (file://)"
    Write-Host "  2  Web game    - GEMINI on GitHub Pages (login URL)"
    Write-Host ""
    $choice = Read-Host "Enter 1 or 2"
    $c = if ($null -eq $choice) { "" } else { $choice.Trim() }
    $lc = $c.ToLowerInvariant()
    if ($lc -eq "2" -or $lc -eq "g" -or $lc -eq "h" -or $lc -eq "w" -or $lc -eq "github" -or $lc -eq "hosted" -or $lc -eq "web") {
        $Hosted = $true
    }
    else {
        $Hosted = $false
    }
}

$diskPort = 5599
if (-not [string]::IsNullOrWhiteSpace($env:RISQUE_DISK_PORT)) {
    $dp = 0
    if ([int]::TryParse($env:RISQUE_DISK_PORT.Trim(), [ref]$dp) -and $dp -gt 0 -and $dp -lt 65536) {
        $diskPort = $dp
    }
}
$diskApiBaseForJson = ""
if ($Hosted) {
    Write-RisqueLauncherPaths -GameDir $RepoRoot -DiskApiBase "" -PeriodicBrowserRestartEveryRounds 0
}
else {
    $diskApiBaseForJson = Start-RisqueLocalDiskApi -SaveRootPath $SaveRoot -Port $diskPort
    Write-RisqueLauncherPaths -GameDir $RepoRoot -DiskApiBase $diskApiBaseForJson -PeriodicBrowserRestartEveryRounds $PeriodicBrowserRestartRounds
    Write-RisqueBrowserResumeRestartContext -SaveRootPath $SaveRoot -BatchPath (Join-Path $ScriptDir "RISQUE.bat") -BatWorkingDirectory $ScriptDir
}

if ($PrepareEnvOnly) {
    if (-not $Hosted) {
        $indexLocalCheck = Join-Path $RepoRoot "index.html"
        if (-not (Test-Path -LiteralPath $indexLocalCheck)) {
            Write-Host "ERROR: index.html not found in repo root: $RepoRoot" -ForegroundColor Red
            exit 1
        }
    }
    Write-RisqueRuntimeStatus -SaveRootPath $SaveRoot -DiskApiBase $diskApiBaseForJson -HostedMode:$Hosted
    Write-Host "PrepareEnvOnly: save root + launcher paths ready (no browser launched)." -ForegroundColor Green
    Write-Host "  Repo: $RepoRoot"
    Write-Host "  Save: $SaveRoot"
    exit 0
}

$indexLocal = Join-Path $RepoRoot "index.html"
if (-not $Hosted) {
    if (-not (Test-Path -LiteralPath $indexLocal)) {
        Write-Host "ERROR: index.html not found in repo root: $RepoRoot" -ForegroundColor Red
        exit 1
    }
}

$launchUrl = $null

if ($Hosted) {
    if ($HostedUrl) {
        $launchUrl = $HostedUrl
    }
    else {
        $launchUrl = $DefaultHostedUrl
    }
    Write-Host "Launch mode: HOSTED" -ForegroundColor Green
    Write-Host "  $launchUrl"
}
else {
    Write-Host "Launch mode: LOCAL" -ForegroundColor Green
    Write-Host "  Repo: $RepoRoot"
    Write-Host "  Save root: $SaveRoot"

    $launchUrl = ConvertTo-FileUri -Path $indexLocal
    Write-Host "  URL (file://):  $launchUrl"
}

$publicTvUrl = $null
if ($launchUrl -match '(?i)^https?:') {
    $publicTvUrl = Get-RisquePublicTvUrlFromIndexUrl -IndexUrl $launchUrl
}
else {
    $replayDbgOn = $true
    if ($NoReplayDebug -or $env:RISQUE_NO_REPLAY_DEBUG -eq '1') {
        $replayDbgOn = $false
    }
    $pair = if ($replayDbgOn) {
        Get-RisqueLocalDiskHostPublicUrls -RepoRootPath $RepoRoot -ReplayDebug
    }
    else {
        Get-RisqueLocalDiskHostPublicUrls -RepoRootPath $RepoRoot -ReplayDebugOff
    }
    $launchUrl = $pair.Host
    $publicTvUrl = $pair.Public
    $pendingHostResume = Join-Path $SaveRoot ".risque-pending-periodic-host-resume"
    if (-not $Hosted -and (Test-Path -LiteralPath $pendingHostResume)) {
        $sep = $(if ($launchUrl -match '\?') { '&' } else { '?' })
        $launchUrl = $launchUrl + $sep + 'risqueResumePeriodicCheckpoint=1'
        try {
            Remove-Item -LiteralPath $pendingHostResume -Force -ErrorAction SilentlyContinue
        }
        catch { }
    }
}

$useDual = (-not $SingleWindow) -and (-not [string]::IsNullOrWhiteSpace($publicTvUrl))

if ($useDual) {
    Write-RisqueRuntimeStatus -SaveRootPath $SaveRoot -DiskApiBase $diskApiBaseForJson -HostedMode:$Hosted
    Write-Host ""
    Write-Host "Dual displays: host on primary, public TV on secondary..." -ForegroundColor Cyan
    Write-Host "  Host URL:   $launchUrl"
    Write-Host "  Public URL: $publicTvUrl"
    try {
        Invoke-RisqueDualMonitorBrowserLaunch -HostUrl $launchUrl -PublicUrl $publicTvUrl -DownloadPath $SaveRoot -ScriptsDirectory $ScriptDir
    }
    catch {
        Write-Host "ERROR: Dual-display launch failed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
    exit 0
}

if ([string]::IsNullOrWhiteSpace($publicTvUrl) -and -not $SingleWindow) {
    Write-Warning "Could not derive public TV URL - falling back to single browser window."
}

$browser = Get-RisqueBrowserPath
if (-not $browser) {
    Write-Host "ERROR: Chrome/Edge not found. Install Google Chrome or Microsoft Edge." -ForegroundColor Red
    exit 1
}

$profileHost = $BrowserProfileHost
New-Item -ItemType Directory -Path $profileHost -Force | Out-Null
Set-RisqueChromiumDownloadDirectory -ProfileDir $profileHost -DownloadDir $SaveRoot
Write-Host "Chromium default download folder set to: $SaveRoot" -ForegroundColor Cyan
Write-RisqueRuntimeStatus -SaveRootPath $SaveRoot -DiskApiBase $diskApiBaseForJson -HostedMode:$Hosted

$browserArgs = @(
    "--user-data-dir=$profileHost",
    "--new-window",
    $RisqueLauncherInstanceFlag,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    $launchUrl
)

Write-Host ""
Write-Host "Starting browser (single window)..." -ForegroundColor Cyan
Start-Process -FilePath $browser -ArgumentList $browserArgs -WindowStyle Normal

exit 0
