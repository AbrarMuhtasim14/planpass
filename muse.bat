@echo off
title Muse Code - Interactive Agent
cd /d "%~dp0"
echo ==========================================================
echo  Meta Muse Code Agent (Muse Wonder 1.0 - Frontier Model)
echo ==========================================================
echo.
"%LOCALAPPDATA%\Programs\muse\muse.cmd" --model muse-wonder-1.0 --yolo
