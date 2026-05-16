@echo off
title D.Va Git - Build ^& Install
cd /d "%~dp0"

echo ============================================
echo   D.Va Git - Build installer
echo   Install path: C:\Program Files (x86)\DvaGit
echo ============================================
echo.

if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
  if errorlevel 1 goto :err
)

echo Running electron-builder (Windows NSIS)...
call npx electron-builder --win nsis
if errorlevel 1 goto :err

echo.
echo Build complete.

set "INSTALLER="
for %%F in ("dist\*Setup*.exe") do set "INSTALLER=%%~fF"

if not defined INSTALLER (
  echo No installer found in dist\ - build may have failed.
  goto :err
)

echo Installer: %INSTALLER%
echo.
choice /C YN /M "Run the installer now"
if errorlevel 2 goto :done
echo Launching installer (defaults to C:\Program Files ^(x86^)\DvaGit)...
start "" "%INSTALLER%"

:done
echo.
echo Done.
pause
exit /b 0

:err
echo.
echo BUILD FAILED - see the messages above.
pause
exit /b 1
