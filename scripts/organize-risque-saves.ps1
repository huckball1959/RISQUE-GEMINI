# Flat SAVE layout only — no subfolders, no file moves.
# Older versions created GAME / REPLAY / STAGING / archive and sorted JSON into them; that is intentionally disabled.
# Parameters kept so risque-organize-watch.ps1 and any shortcuts keep working without errors.

param(
    [Parameter(Mandatory = $true)][string]$SaveRoot,
    [string]$SessionStamp = ""
)

$ErrorActionPreference = "Continue"
try {
    [void][System.IO.Path]::GetFullPath($SaveRoot.Trim())
}
catch {
    return
}

exit 0
