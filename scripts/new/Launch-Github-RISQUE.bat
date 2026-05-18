@echo off
setlocal
REM ============================================================================
REM  RISQUE — launch HOSTED build: GitHub Pages RISQUE (stable / release mirror)
REM  https://huckball1959.github.io/RISQUE/
REM  No local disk API; browser folder permissions apply for saves.
REM
REM  Optional args pass through, e.g. Launch-Github-RISQUE.bat -SingleWindow
REM ============================================================================

cd /d "%~dp0"
set "RISQUE_PS=%~dp0..\RISQUE.ps1"
if not exist "%RISQUE_PS%" (
  echo ERROR: RISQUE.ps1 not found:
  echo   %RISQUE_PS%
  pause
  exit /b 1
)

set "RISQUE_STABLE_URL=https://huckball1959.github.io/RISQUE/game.html?phase=login&loginLegacyNext=game.html%%3Fphase%%3DplayerSelect%%26selectKind%%3DfirstCard&loginLoadRedirect=game.html%%3Fphase%%3Dcardplay%%26legacyNext%%3Dincome.html"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RISQUE_PS%" -SkipMenu -Hosted -HostedUrl "%RISQUE_STABLE_URL%" %*
set "RISQUE_EC=%ERRORLEVEL%"
if not "%RISQUE_EC%"=="0" (
  echo.
  echo Launch-Github-RISQUE exited with error code %RISQUE_EC%.
  pause
)
exit /b %RISQUE_EC%
