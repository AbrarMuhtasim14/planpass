@echo off
title PlanPass TypeScript Compiler
cd /d "%~dp0"
echo ====================================================
echo  PlanPass - Building TypeScript Codebase (tsc)
echo ====================================================
echo.
npm run build
if %ERRORLEVEL% equ 0 (
  echo [SUCCESS] Codebase compiled cleanly with 0 errors!
) else (
  echo [ERROR] Build failed. Review errors above.
)
echo.
pause
