# Dev helper: flat SAVE only — does not create GAME/REPLAY (legacy layout removed).

param(
    [string]$SaveRoot = "C:\risque\save"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $SaveRoot)) {
    New-Item -Path $SaveRoot -ItemType Directory -Force | Out-Null
}
Write-Host "Save root ready (flat — no subfolders): $SaveRoot" -ForegroundColor Green
