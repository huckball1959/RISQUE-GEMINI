# RISQUE Dual Monitor Launcher - Clean Auto Version
Add-Type -AssemblyName System.Windows.Forms

$hostUrl   = $env:RISQUE_LAUNCH_HOST_URL
$publicUrl = $env:RISQUE_LAUNCH_PUBLIC_URL

Write-Host "RISQUE Launcher Starting..." -ForegroundColor Green

# Find Chrome
$chrome = "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { 
    $chrome = "chrome.exe" 
}

# Separate profiles
$hostDir = Join-Path $env:TEMP "risque-host"
$pubDir  = Join-Path $env:TEMP "risque-public"

# Get monitors
$screens = [System.Windows.Forms.Screen]::AllScreens
$primary   = $screens[0]
$secondary = if ($screens.Count -ge 2) { $screens[1] } else { $primary }

Write-Host "Primary Monitor   : $($primary.DeviceName)" -ForegroundColor Cyan
if ($screens.Count -ge 2) {
    Write-Host "Secondary Monitor : $($secondary.DeviceName)" -ForegroundColor Cyan
}

# Launch Host (Monitor 1 - Fullscreen)
Write-Host "Launching Host view on Monitor 1..." -ForegroundColor Green
$hostArgs = @(
    "--user-data-dir=`"$hostDir`""
    "--new-window"
    "--window-position=$($primary.Bounds.X),$($primary.Bounds.Y)"
    "--start-fullscreen"
    "`"$hostUrl`""
)
Start-Process $chrome -ArgumentList $hostArgs

Start-Sleep -Seconds 5

# Launch Public/TV (Monitor 2 - Fullscreen)
Write-Host "Launching Public/TV view on Monitor 2..." -ForegroundColor Green
$pubArgs = @(
    "--user-data-dir=`"$pubDir`""
    "--new-window"
    "--window-position=$($secondary.Bounds.X),$($secondary.Bounds.Y)"
    "--start-fullscreen"
    "`"$publicUrl`""
)
Start-Process $chrome -ArgumentList $pubArgs

Write-Host "`nRISQUE Launcher completed!" -ForegroundColor Green
Write-Host "Host should be fullscreen on Monitor 1" -ForegroundColor Yellow
Write-Host "TV should be fullscreen on Monitor 2" -ForegroundColor Yellow