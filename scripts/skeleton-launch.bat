@echo off
setlocal
REM ============================================================================
REM  RISQUE-GEMINI — skeleton-launch (portable "latest scripts" fetcher)
REM
REM  Copies nothing from this machine's repo: it downloads whatever is currently
REM  in GitHub RISQUE-GEMINI /scripts (batch, PowerShell, HTML fixtures, etc.)
REM  into your Downloads folder (default), so another PC can stay current as
REM  launcher files change.
REM
REM  First-time on a blank PC: save this .bat AND skeleton-launch.ps1 from GitHub
REM  (Raw) into the same folder, double-click this .bat, then run RISQUE.bat from
REM  Downloads\RISQUE-GEMINI-scripts
REM
REM  Optional: pass through PowerShell script args, e.g.:
REM    skeleton-launch.bat -Dest "D:\RISQUE\scripts" -Branch main -OpenFolder
REM
REM  Environment override:
REM    set RISQUE_SCRIPT_SYNC_DEST=D:\somewhere
REM    skeleton-launch.bat
REM ============================================================================

cd /d "%~dp0"

set "SKEL_PS=%~dp0skeleton-launch.ps1"
if not exist "%SKEL_PS%" (
  echo ERROR: skeleton-launch.ps1 not found next to this file:
  echo   %SKEL_PS%
  echo On a fresh PC, download both skeleton-launch.bat and skeleton-launch.ps1 from GitHub into the same folder.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SKEL_PS%" %*

set "SKEL_EC=%ERRORLEVEL%"
if not "%SKEL_EC%"=="0" (
  echo.
  echo skeleton-launch failed with exit code %SKEL_EC%.
  pause
)
exit /b %SKEL_EC%
