@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0set-download.ps1"

endlocal