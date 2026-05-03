# RISQUE Launcher v2 - Complete Version
# Features: Dual fullscreen monitors + Auto create C:\RISQUE\SAVE + Set Edge download folder

# Win32 move after launch — Edge often ignores --window-position on the 2nd process (TV ends up on primary).
$chromiumPs1 = Join-Path $PSScriptRoot "risque-chromium-primary.ps1"
if (-not (Test-Path -LiteralPath $chromiumPs1)) { throw "Missing $chromiumPs1" }
. $chromiumPs1

Add-Type -AssemblyName System.Windows.Forms

$hostUrl      = $env:RISQUE_LAUNCH_HOST_URL
$publicUrl    = $env:RISQUE_LAUNCH_PUBLIC_URL
$downloadPath = $env:RISQUE_DOWNLOAD_PATH

Write-Host "RISQUE Launcher v2 Starting..." -ForegroundColor Green

# === 1. Create Download Folder ===
if (-not (Test-Path $downloadPath)) {
    New-Item -Path $downloadPath -ItemType Directory -Force | Out-Null
    Write-Host "✓ Created download folder: $downloadPath" -ForegroundColor Green
} else {
    Write-Host "✓ Download folder exists: $downloadPath" -ForegroundColor Green
}

# === 2. Set Edge Download Folder (for Host window) ===
$edgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgeExe)) { $edgeExe = "msedge.exe" }

$hostProfileDir = Join-Path $env:TEMP "risque-host"
$defaultDir = Join-Path $hostProfileDir "Default"
$prefsPath = Join-Path $defaultDir "Preferences"

New-Item -Path $defaultDir -ItemType Directory -Force | Out-Null

# Write download preferences
$prefs = @{}
if (Test-Path $prefsPath) {
    try { $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json -Depth 100 } catch { }
}

if (-not $prefs.savefile) { $prefs.savefile = @{} }
if (-not $prefs.download)  { $prefs.download = @{} }

$prefs.savefile.default_directory   = $downloadPath
$prefs.download.default_directory   = $downloadPath
$prefs.download.prompt_for_download = $false

$prefs | ConvertTo-Json -Depth 100 | Out-File -FilePath $prefsPath -Encoding UTF8 -Force

# === 3. Get Monitor Information ===
# AllScreens[0] is not guaranteed to be the Windows "primary" display — use PrimaryScreen.
$primary = [System.Windows.Forms.Screen]::PrimaryScreen
$secondary = $primary
foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
    if ($s.DeviceName -ne $primary.DeviceName) {
        $secondary = $s
        break
    }
}

# Host + TV must share ONE Edge profile. localStorage (risquePublicMirrorState) is per
# user-data-dir; separate dirs = no public mirror — manual opens worked because both used default profile.
$edgeDataDir = $hostProfileDir

if ($secondary.DeviceName -eq $primary.DeviceName) {
    Write-Warning "Only one display detected — public window will open on top of the host."
}

$pRect = $primary.WorkingArea
$sRect = $secondary.WorkingArea

# === 4. Launch Host on primary monitor (Fullscreen) ===
Write-Host "Launching Host on primary ($($pRect.Width)x$($pRect.Height))..." -ForegroundColor Cyan
$hostArgs = @(
    "--user-data-dir=`"$edgeDataDir`""
    "--new-window"
    "--window-position=$($pRect.Left),$($pRect.Top)"
    "--start-fullscreen"
    "--no-first-run"
    "`"$hostUrl`""
)
Start-Process $edgeExe -ArgumentList $hostArgs

Start-Sleep -Seconds 5

# Snapshot Chromium top-level HWNDs (host is already open) so we can find the NEW window for public.
$beforePub = [ChromiumWindowHelper]::ListRootChromium().ToArray()

# === 5. Launch Public/TV (then force it onto the extended monitor with Win32 — Edge CLI placement is unreliable) ===
Write-Host "Launching Public/TV (will move to secondary $([Math]::Round($sRect.Left)),$([Math]::Round($sRect.Top)) $($sRect.Width)x$($sRect.Height))..." -ForegroundColor Cyan
$pubArgs = @(
    "--user-data-dir=`"$edgeDataDir`""
    "--new-window"
    "--no-first-run"
    "`"$publicUrl`""
)
Start-Process $edgeExe -ArgumentList $pubArgs

$pubHwnd = Wait-RisqueNewChromiumWindow -BeforeHandles $beforePub -TimeoutMs 20000
if ($pubHwnd -eq [IntPtr]::Zero) {
    Write-Warning "Could not detect the new Edge window handle — TV may stay on the wrong display."
}
else {
    Start-Sleep -Milliseconds 400
    Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
    Start-Sleep -Milliseconds 700
    Move-RisqueChromiumToRect -Handle $pubHwnd -Left $sRect.Left -Top $sRect.Top -Width $sRect.Width -Height $sRect.Height
    Write-Host "Moved public window to secondary monitor (Win32)." -ForegroundColor Green
}

Write-Host "`nRISQUE Launcher v2 Completed Successfully!" -ForegroundColor Green
Write-Host "Download folder set to: $downloadPath" -ForegroundColor Yellow