@echo off
setlocal EnableExtensions
REM ============================================================================
REM  RISQUE — "clean localStorage" style launch WITHOUT touching your main Chrome.
REM
REM  Browsers do not support "clear site data for one URL" from the command line.
REM  This script uses a DEDICATED Chromium user-data folder, deletes it before
REM  each launch, then starts Chrome (or Edge) with --user-data-dir= that folder.
REM  Result: empty localStorage / cookies / etc. for that profile every run.
REM
REM  Tradeoffs:
REM   - You must pick the save folder again after each run (File System Access
REM     permission is stored in that profile).
REM   - Close any window using this profile before the script deletes the folder,
REM     or rd will fail (script tells you).
REM   - This does NOT delete your C:\risque\save JSON files — only the browser
REM     profile under the path below.
REM
REM  Edit PROFILE if you want a different folder (keep it dedicated to RISQUE).
REM ============================================================================

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"

set "PROFILE=C:\risque\RisquePlayChromiumProfile"
set "GAME_HTML=%REPO_ROOT%\game.html"

if not exist "%GAME_HTML%" (
  echo ERROR: game.html not found:
  echo   %GAME_HTML%
  echo Fix REPO_ROOT or place game.html next to the repo layout expected by this script.
  pause
  exit /b 1
)

echo.
echo Dedicated browser profile (will be deleted next):
echo   %PROFILE%
echo.
echo Close any Chrome/Edge window that was started with this same profile, then continue.
pause

if exist "%PROFILE%" (
  rd /s /q "%PROFILE%" 2>nul
)
if exist "%PROFILE%" (
  echo ERROR: Could not delete profile folder. Something still has it open.
  pause
  exit /b 1
)
mkdir "%PROFILE%" 2>nul

REM ---- Choose ONE browser block (Chrome default). Uncomment Edge if you prefer. ----

set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

REM set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
REM if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not exist "%BROWSER%" (
  echo ERROR: Browser not found at:
  echo   %BROWSER%
  echo Edit this script: set BROWSER= to your chrome.exe or msedge.exe path.
  pause
  exit /b 1
)

echo Starting:
echo   "%BROWSER%"
echo   --user-data-dir="%PROFILE%"
echo   "%GAME_HTML%"
echo.

start "" "%BROWSER%" --user-data-dir="%PROFILE%" "%GAME_HTML%"
exit /b 0
