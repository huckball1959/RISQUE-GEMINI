@echo off
setlocal
title RISQUE test folder creator

REM Ensures a flat save root only (default C:\risque\save via RISQUE_DOWNLOAD_PATH or C:\RISQUE\SAVE fallback).

REM Optional: set SAVE root
if defined RISQUE_DOWNLOAD_PATH (
  set "SAVE=%RISQUE_DOWNLOAD_PATH%"
) else (
  set "SAVE=C:\risque\save"
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0testfilecreator.ps1" -SaveRoot "%SAVE%"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo Failed with exit code %ERR%.
  pause
  exit /b %ERR%
)

echo.
pause
endlocal
exit /b 0
