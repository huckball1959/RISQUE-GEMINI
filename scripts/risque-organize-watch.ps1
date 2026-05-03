# Background: periodically runs organize-risque-saves.ps1 (flat layout — script is a no-op).
# Only one instance runs machine-wide (mutex).

param(
    [Parameter(Mandatory = $true)][string]$SaveRoot,
    [string]$SessionStamp = "",
    [int]$IntervalSeconds = 25
)

$ErrorActionPreference = "Continue"

$mutexName = "Global\RISQUE_ORGANIZE_WATCH_SINGLETON"
$created = $false
try {
    $null = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
    if (-not $created) {
        exit 0
    }
}
catch {
    exit 0
}

$organize = Join-Path $PSScriptRoot "organize-risque-saves.ps1"
if (-not (Test-Path -LiteralPath $organize)) { exit 0 }

while ($true) {
    try {
        & $organize -SaveRoot $SaveRoot
    }
    catch { }
    Start-Sleep -Seconds $IntervalSeconds
}
