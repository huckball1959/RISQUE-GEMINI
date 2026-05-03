@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RISQUE Launcher v2

echo =====================================
echo    RISQUE Launcher v2 - Local
echo =====================================
echo.

:: Configuration
set "LOCAL_ROOT=C:\GitHub\RISQUE-BETA"
set "DOWNLOAD_FOLDER=C:\RISQUE\SAVE"

set "URL_HOST=file:///%LOCAL_ROOT:\=/%/index.html"
set "URL_PUBLIC=file:///%LOCAL_ROOT:\=/%/game.html?display=public"

:: Pass variables to PowerShell
set "RISQUE_LAUNCH_HOST_URL=%URL_HOST%"
set "RISQUE_LAUNCH_PUBLIC_URL=%URL_PUBLIC%"
set "RISQUE_DOWNLOAD_PATH=%DOWNLOAD_FOLDER%"

echo Launching RISQUE with custom download folder...
echo Host  → Primary monitor (Edge fullscreen)
echo TV    → Extended monitor (sized to fill that screen; avoids fullscreen-on-wrong-display bug)
echo.

:: Run the PowerShell script silently
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0launch2.ps1"

endlocal