@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\risque-dual-monitors.ps1"
if errorlevel 1 (
  echo.
  echo Launch failed. Press any key to close.
  pause >nul
)
endlocal
