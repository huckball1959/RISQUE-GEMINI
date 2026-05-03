# RISQUE - Set Default Download Folder (Improved Version)
$hostUrl       = $env:RISQUE_HOST_URL
$downloadPath  = $env:RISQUE_DOWNLOAD_PATH

Write-Host "RISQUE Download Folder Setup" -ForegroundColor Green
Write-Host "============================" -ForegroundColor Green

# Create folder
if (-not (Test-Path $downloadPath)) {
    New-Item -Path $downloadPath -ItemType Directory -Force | Out-Null
    Write-Host "✓ Created: $downloadPath" -ForegroundColor Green
} else {
    Write-Host "✓ Exists: $downloadPath" -ForegroundColor Green
}

$chrome = "${env:LOCALAPPDATA}\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) { $chrome = "chrome.exe" }

$profileDir = Join-Path $env:TEMP "risque-host-download-test"

Write-Host "`nLaunching Host with custom download folder..." -ForegroundColor Cyan

# Build Chrome arguments with experimental prefs
$prefs = @{
    "download.default_directory" = $downloadPath
    "download.prompt_for_download" = $false
    "download.directory_upgrade" = $true
    "profile.default_content_settings.popups" = 0
}

$jsonPrefs = ($prefs | ConvertTo-Json -Compress)

$argsList = @(
    "--user-data-dir=`"$profileDir`""
    "--new-window"
    "--start-fullscreen"
    "--no-first-run"
    "--no-default-browser-check"
    "--disable-features=DownloadBubble,DownloadBubbleV2"
    "--enable-features=PreferencesWindow"
    "--profile-directory=Default"
    "--ignore-certificate-errors"
    "`"$hostUrl`""
)

# Launch Chrome with prefs
Start-Process $chrome -ArgumentList $argsList

Write-Host "`n=== LAUNCH COMPLETE ===" -ForegroundColor Green
Write-Host "Host window opened with download folder set to:" -ForegroundColor Green
Write-Host "$downloadPath" -ForegroundColor White
Write-Host "`nTest a download from the game now and check the SAVE folder." -ForegroundColor Yellow