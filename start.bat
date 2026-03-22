@echo off
title Zenith — Dev Server
echo.
echo  ============================================
echo   ZENITH — AI-Powered File Staging Dropzone
echo  ============================================
echo.

:: Check prerequisites
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)

where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Rust/Cargo not found. Install from https://rustup.rs
    pause
    exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Python not found. AI/processing features will not work.
    echo        Install from https://python.org
    echo.
)

:: Install Node dependencies if needed
if not exist "node_modules\" (
    echo [1/3] Installing Node dependencies...
    call npm install
    echo.
) else (
    echo [1/3] Node dependencies OK
)

:: Install Python dependencies if needed
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [2/3] Installing Python dependencies...
    pip install -r scripts\requirements.txt -q
    echo.
) else (
    echo [2/3] Skipping Python dependencies (Python not found)
)

:: Start dev server
echo [3/3] Starting Zenith dev server...
echo.
echo  Press Ctrl+C to stop.
echo.
call npm run tauri dev
