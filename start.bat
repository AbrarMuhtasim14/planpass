@echo off
title PlanPass Web Server
cd /d "%~dp0"
echo ====================================================
echo  PlanPass - Starting Server on http://localhost:3000
echo ====================================================
echo.
start http://localhost:3000
node dist/server.js
pause
