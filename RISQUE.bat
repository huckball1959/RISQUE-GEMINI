@echo off
setlocal
REM ============================================================================
REM  RISQUE-BETA — opens the game from disk (file://). No local HTTP server.
REM  Delegates to scripts\RISQUE.ps1 (save tree, launcher-paths, Chromium downloads).
REM ============================================================================

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\RISQUE.ps1" %*
exit /b %ERRORLEVEL%
