@echo off
setlocal
REM ============================================================================
REM  RISQUE-BETA — entry point (double-click safe)
REM  Runs scripts\RISQUE.ps1: ensures C:\RISQUE\SAVE, writes risque-launcher-paths.json in repo only, Chromium download = SAVE,
REM  then asks: (1) Local game  (2) GitHub Pages.
REM  Default: two windows — host on primary display, public TV on secondary (Win32 move + F11).
REM  Local game is always file:// (no local HTTP server).
REM
REM  Script folder:  %~dp0   (e.g. ...\RISQUE-BETA\scripts\)
REM  Repo root:      parent of scripts   (e.g. ...\RISQUE-BETA\)
REM  Save tree:      C:\RISQUE\SAVE\ or %RISQUE_DOWNLOAD_PATH%
REM
REM  Optional args pass through to RISQUE.ps1, e.g.:
REM    RISQUE.bat -SkipMenu              (no prompt; local launch)
REM    RISQUE.bat -Hosted                (no prompt; GitHub Pages)
REM    RISQUE.bat -HostedUrl "https://.../index.html"
REM    RISQUE.bat -SingleWindow          (one browser tab only; no dual-monitor flow)
REM    RISQUE.bat -File                  (legacy; same as default local file://)
REM    RISQUE.bat -NoEmergencyWatcher    (legacy; emergency watcher not started by default)
REM
REM ============================================================================

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0RISQUE.ps1" %*
set "RISQUE_EC=%ERRORLEVEL%"
if not "%RISQUE_EC%"=="0" (
  echo.
  echo RISQUE launcher exited with error code %RISQUE_EC%.
  echo If the window closed too fast, run from a Command Prompt:
  echo   cd /d "%~dp0"
  echo   RISQUE.bat
  pause
)
exit /b %RISQUE_EC%
