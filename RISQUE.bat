@echo off
setlocal
REM ============================================================================
REM  RISQUE-GEMINI — launcher entry (double-click). Delegates to scripts\RISQUE.ps1:
REM  flat save folder, risque-launcher-paths.json, menu (1) local file:// (2) hosted GEMINI URL.
REM  Extra args pass through (e.g. -NoReplayDebug). See scripts\RISQUE.ps1 header.
REM ============================================================================

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\RISQUE.ps1" %*
exit /b %ERRORLEVEL%
