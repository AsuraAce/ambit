@echo off
setlocal
title Ambit Video Smoke Launcher
cd /d "%~dp0"

echo Starting Ambit with the isolated video-smoke profile...
echo Your normal Ambit and shared development libraries will not be used.
echo.

call corepack pnpm run app:video-smoke
if errorlevel 1 (
    echo.
    echo Ambit could not start. Keep this window open and share the error shown above.
    pause
)
