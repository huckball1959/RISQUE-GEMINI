@echo off
setlocal
title RISQUE - Reset Edge Download Folder

echo ================================================
echo    RISQUE - Reset Default Download Folder
echo ================================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0RESET-DEFAULT.ps1"

echo Default download folder has been reset.
echo.
echo Press any key to close...
pause >nul
endlocal