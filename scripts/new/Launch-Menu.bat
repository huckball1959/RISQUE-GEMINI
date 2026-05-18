@echo off
setlocal
REM ============================================================================
REM  RISQUE — pick launch target (no typing URLs)
REM    1  Local game (this repo on disk)
REM    2  GitHub RISQUE-GEMINI (Pages)
REM    3  GitHub RISQUE (Pages)
REM ============================================================================

cd /d "%~dp0"

:menu
echo.
echo  RISQUE launcher menu
echo    1  Local game (file:// from this clone)
echo    2  GitHub RISQUE-GEMINI
echo    3  GitHub RISQUE
echo.
set /p RISQUE_CHOICE=Enter 1, 2, or 3: 

if "%RISQUE_CHOICE%"=="1" goto local
if "%RISQUE_CHOICE%"=="2" goto gemini
if "%RISQUE_CHOICE%"=="3" goto risque

echo Invalid choice — try again.
goto menu

:local
call "%~dp0Launch-Local.bat" %*
exit /b %ERRORLEVEL%

:gemini
call "%~dp0Launch-Github-RISQUE-GEMINI.bat" %*
exit /b %ERRORLEVEL%

:risque
call "%~dp0Launch-Github-RISQUE.bat" %*
exit /b %ERRORLEVEL%
