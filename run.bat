@echo off
title D.Va Git - MEKA OS
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
)
echo.
echo  ============================================
echo   D.Va Git - Pilot, suit up! Nerf this!
echo  ============================================
echo.
call npm start
