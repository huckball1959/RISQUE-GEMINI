@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RISQUE - Default Download Folder Setup

echo ================================================
echo    RISQUE - Default Download Folder Setup
echo ================================================
echo.

set "LOCAL_ROOT=C:\GitHub\RISQUE-BETA"
set "DOWNLOAD_FOLDER=C:\RISQUE\SAVE"

set "RISQUE_HOST_URL=file:///%LOCAL_ROOT:\=/%/index.html"
set "RISQUE_DOWNLOAD_PATH=%DOWNLOAD_FOLDER%"

echo Target Download Folder: %DOWNLOAD_FOLDER%
echo This test will NOT open the game.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0default.ps1"

echo.
echo Press any key to close this window...
pause >nul
endlocal