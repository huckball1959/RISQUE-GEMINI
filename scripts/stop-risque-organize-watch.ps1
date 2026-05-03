# Stops background PowerShell processes running risque-organize-watch.ps1 (safe if none running).
$ErrorActionPreference = "SilentlyContinue"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*risque-organize-watch.ps1*' } |
    ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force
        Write-Host "Stopped PID $($_.ProcessId)"
    }
Write-Host "Done. (If Chrome/Edge still had the game open, session-disk could still touch folders.)"
