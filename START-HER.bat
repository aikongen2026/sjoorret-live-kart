@echo off
chcp 65001 >nul
title Sjøørret Live Kart v11
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starter Sjøørret Live Kart v11...
  start "Sjøørret v11-server" /min cmd /c "node server.js"
  timeout /t 2 /nobreak >nul
  start "" http://localhost:3000
  echo.
  echo Appen er startet i nettleseren: http://localhost:3000
  echo Du kan lukke dette vinduet. Serveren kjører i et eget minimert vindu.
  pause
  exit /b
)

echo.
echo Node.js 20 eller nyere er ikke installert på denne PC-en.
echo Installer LTS-versjonen fra https://nodejs.org/ og kjør START-HER.bat på nytt.
echo.
start "" https://nodejs.org/
pause
