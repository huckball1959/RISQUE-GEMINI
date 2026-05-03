# Minimal silent - Force Edge download folder using savefile + download prefs

$downloadPath = "C:\RISQUE\SAVE"

# Create the folder
if (-not (Test-Path $downloadPath)) {
    New-Item -Path $downloadPath -ItemType Directory -Force | Out-Null
}

$edgeExe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgeExe)) { $edgeExe = "msedge.exe" }

$profileDir = Join-Path $env:TEMP "risque-edge-download-test"

# Launch Edge once with the profile to initialize it
Start-Process $edgeExe -ArgumentList "--user-data-dir=`"$profileDir`" --profile-directory=Default --no-first-run" -WindowStyle Hidden

Start-Sleep -Seconds 4

# Now write the Preferences file with the most effective keys
$defaultDir = Join-Path $profileDir "Default"
$prefsPath = Join-Path $defaultDir "Preferences"

New-Item -Path $defaultDir -ItemType Directory -Force | Out-Null

$prefs = @{}
if (Test-Path $prefsPath) {
    try { $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json -Depth 100 } catch { }
}

# These two are the most important for Edge
if (-not $prefs.savefile) { $prefs.savefile = @{} }
if (-not $prefs.download)  { $prefs.download = @{} }

$prefs.savefile.default_directory   = $downloadPath
$prefs.download.default_directory   = $downloadPath
$prefs.download.prompt_for_download = $false

$prefs | ConvertTo-Json -Depth 100 | Out-File -FilePath $prefsPath -Encoding UTF8 -Force