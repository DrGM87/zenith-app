@echo off
title Zenith Launcher
echo Starting Zenith...

cd /d "%~dp0"

:: Check if built exe exists
if exist "src-tauri\target\release\zenith-app.exe" (
    echo Launching release build...
    start "" "src-tauri\target\release\zenith-app.exe"
    exit /b
)

if exist "src-tauri\target\debug\zenith-app.exe" (
    echo Launching debug build...
    start "" "src-tauri\target\debug\zenith-app.exe"
    exit /b
)

:: No built exe, run dev mode
echo No build found. Running in dev mode...
echo (Press Ctrl+C to stop)
npm run tauri dev
