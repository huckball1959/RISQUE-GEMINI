@echo off
setlocal
REM ============================================================================
REM  RISQUE-BETA — dual displays (host + public TV). Same as RISQUE.bat; dual is
REM  the default unless you pass -SingleWindow to scripts\RISQUE.ps1.
REM  No local HTTP server — file:// only.
REM ============================================================================

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\RISQUE.ps1" %*
exit /b %ERRORLEVEL%
