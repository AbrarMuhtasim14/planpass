@echo off
title PlanPass Verification Suite
cd /d "%~dp0"
echo ====================================================
echo  PlanPass - Automated End-to-End Test Suite
echo ====================================================
echo.
npm test
echo.
echo ====================================================
pause
