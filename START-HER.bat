@echo off
chcp 65001 >nul
title Sjøørret Live Kart v9
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  echo Starter lokal server...
  start "" http://localhost:3000
  node server.js
  pause
  exit /b
)

echo.
echo Node.js er ikke installert på denne PC-en.
echo.
echo Anbefalt nå: legg appen på Render, så virker den direkte på Samsung:
echo https://dashboard.render.com/
echo.
echo Åpner DEPLOY-RENDER.txt med steg-for-steg.
start notepad "%~dp0DEPLOY-RENDER.txt"
pause
