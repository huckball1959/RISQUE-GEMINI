@echo off
setlocal
REM ============================================================================
REM  RISQUE-GEMINI — entry point (double-click safe)
REM  Runs scripts\RISQUE.ps1: ensures C:\risque\save (or RISQUE_DOWNLOAD_PATH), writes risque-launcher-paths.json
REM  (local mode sets diskApiBase so DD.json / rNpM land in the save folder — one hidden save-helper on 127.0.0.1:5599),
REM  Chromium download = save root, then asks: (1) Local game  (2) Hosted GEMINI on GitHub Pages.
REM  Default: two windows — host on primary display, public TV on secondary (Win32 move + F11).
REM  Local pages are file://; the save helper is not a game web server.
REM
REM  Script folder:  %~dp0   (e.g. ...\RISQUE-GEMINI\scripts\)
REM  Repo root:      parent of scripts   (e.g. ...\RISQUE-GEMINI\)
REM  Save tree:      C:\RISQUE\SAVE\ or %RISQUE_DOWNLOAD_PATH%
REM
REM  Optional args pass through to RISQUE.ps1, e.g.:
REM    RISQUE.bat -SkipMenu              (no prompt; local launch)
REM    RISQUE.bat -Hosted                (no prompt; GitHub Pages)
REM    RISQUE.bat -HostedUrl "https://.../game.html?phase=login&..."
REM    RISQUE.bat -SingleWindow          (one browser tab only; no dual-monitor flow)
REM    RISQUE.bat -File                  (legacy; same as default local file://)
REM    RISQUE.bat -NoEmergencyWatcher    (legacy; emergency watcher not started by default)
REM    RISQUE.bat -NoReplayDebug         (local only: turn off automatic replay tape console logging)
REM    Or set env RISQUE_NO_REPLAY_DEBUG=1 before launching.
REM    Or set env RISQUE_PERIODIC_RESTART_ROUNDS=0 to disable periodic full browser restarts (local + disk API only).
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
