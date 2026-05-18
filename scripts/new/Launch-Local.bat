@echo off
setlocal
REM ============================================================================
REM  RISQUE — launch LOCAL clone from disk (file://)
REM  Uses scripts\RISQUE.ps1: save folder, disk API on 127.0.0.1:5599, dual displays.
REM  Run from any clone (RISQUE-GEMINI or RISQUE); repo root = parent of \scripts\.
REM
REM  Optional args pass through, e.g.:
REM    Launch-Local.bat -NoReplayDebug
REM    Launch-Local.bat -SingleWindow
REM ============================================================================

cd /d "%~dp0"
set "RISQUE_PS=%~dp0..\RISQUE.ps1"
if not exist "%RISQUE_PS%" (
  echo ERROR: RISQUE.ps1 not found:
  echo   %RISQUE_PS%
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RISQUE_PS%" -SkipMenu %*
set "RISQUE_EC=%ERRORLEVEL%"
if not "%RISQUE_EC%"=="0" (
  echo.
  echo Launch-Local exited with error code %RISQUE_EC%.
  pause
)
exit /b %RISQUE_EC%
