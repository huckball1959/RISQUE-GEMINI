# RISQUE - Reset Edge Default Download Folder to normal behavior

Write-Host "Resetting Edge default download folder..." -ForegroundColor Yellow

$edgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgeExe)) { $edgeExe = "msedge.exe" }

$profileDir = Join-Path $env:TEMP "risque-host"
$defaultDir = Join-Path $profileDir "Default"
$prefsPath  = Join-Path $defaultDir "Preferences"

# If the profile doesn't exist, nothing to reset
if (-not (Test-Path $prefsPath)) {
    Write-Host "No RISQUE profile found. Nothing to reset." -ForegroundColor Gray
    exit 0
}

# Load current preferences
$prefs = @{}
try {
    $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json -Depth 100
} catch {
    $prefs = @{}
}

# Remove or reset the download settings so Edge goes back to default behavior
if ($prefs.download) {
    $prefs.download.default_directory = $null
    $prefs.download.prompt_for_download = $null   # Let Edge ask again if needed
}

if ($prefs.savefile) {
    $prefs.savefile.default_directory = $null
}

# Save the updated preferences
$prefs | ConvertTo-Json -Depth 100 | Out-File -FilePath $prefsPath -Encoding UTF8 -Force

Write-Host "✓ Default download folder has been reset." -ForegroundColor Green
Write-Host "Edge will now use your normal Downloads folder again." -ForegroundColor Green