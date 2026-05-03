@echo off
setlocal EnableExtensions EnableDelayedExpansion
title RISQUE Launcher - Local

echo =====================================
echo    RISQUE Launcher - Local Files
echo =====================================
echo.

:: Configuration - Local files only (Option 1)
set "LOCAL_ROOT=C:\GitHub\RISQUE-BETA"

set "URL_LOCAL_HOST=file:///%LOCAL_ROOT:\=/%/index.html"
set "URL_LOCAL_TV=file:///%LOCAL_ROOT:\=/%/game.html?display=public"

:: Pass URLs to PowerShell
set "RISQUE_LAUNCH_HOST_URL=%URL_LOCAL_HOST%"
set "RISQUE_LAUNCH_PUBLIC_URL=%URL_LOCAL_TV%"

echo Launching RISQUE...
echo Host  → Monitor 1
echo TV    → Monitor 2 (Fullscreen)
echo.

:: Launch the PowerShell script (visible so you can see status)
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"

endlocal