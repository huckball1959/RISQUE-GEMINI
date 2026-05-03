@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
REM One query param only — avoids cmd/PowerShell & parsing; tvBootstrap defaults to on in game-shell.js
set "URL=file:///%ROOT:\=/%game.html?display=public"
start /min "" powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%ROOT%scripts\launch-chrome-url.ps1" "%URL%"
endlocal
