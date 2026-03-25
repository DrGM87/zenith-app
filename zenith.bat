@echo off
setlocal enabledelayedexpansion
title Zenith Launcher
color 0F

:: ============================================================================
::  ZENITH — Unified Launcher
::  Usage: zenith.bat [option]
::    No args  = Auto-launch (rebuild prompt with 5s timeout, then run)
::    1        = Rebuild release + launch
::    2        = Launch current build (build if missing)
::    3        = Start dev server (hot reload)
:: ============================================================================

echo.
echo  ====================================================
echo    ZENITH — AI-Powered File Staging Dropzone
echo  ====================================================
echo.

:: ── Prerequisites Check ──
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
where cargo >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Rust/Cargo not found. Install from https://rustup.rs
    pause
    exit /b 1
)
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARN]  Python not found. AI/processing features will not work.
    echo          Install from https://python.org
    echo.
)

cd /d "%~dp0"

:: ── Handle command-line argument ──
if "%~1"=="1" goto :do_rebuild
if "%~1"=="2" goto :do_launch
if "%~1"=="3" goto :do_dev

:: ── Interactive Menu ──
echo  Choose an option:
echo.
echo    [1] Rebuild release + launch    (full cargo build --release)
echo    [2] Launch current build        (build if not found)
echo    [3] Start dev server            (npm run tauri dev)
echo.
echo  Default: option [2] in 5 seconds...
echo.

:: 5-second countdown — press 1/2/3 to choose, or wait for default
choice /c 123 /t 5 /d 2 /n /m "  Press 1, 2, or 3: "
set PICKED=%errorlevel%

if %PICKED%==1 goto :do_rebuild
if %PICKED%==2 goto :do_launch
if %PICKED%==3 goto :do_dev
goto :do_launch

:: ============================================================================
::  OPTION 1: Full rebuild + launch
:: ============================================================================
:do_rebuild
echo.
echo  [BUILD] Rebuilding Zenith release...
echo  -----------------------------------------------

:: Install Node dependencies if needed
if not exist "node_modules\" (
    echo  [1/4] Installing Node dependencies...
    call npm install
) else (
    echo  [1/4] Node dependencies OK
)

:: Install Python dependencies if needed
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo  [2/4] Installing Python dependencies...
    pip install -r scripts\requirements.txt -q 2>nul
) else (
    echo  [2/4] Skipping Python deps (no Python)
)

:: Build release
echo  [3/4] Building release (this may take a few minutes)...
call npm run tauri build
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] Build failed. Check errors above.
    pause
    exit /b 1
)

echo  [4/4] Build complete!
echo.
goto :launch_exe

:: ============================================================================
::  OPTION 2: Launch current build (build if missing)
:: ============================================================================
:do_launch
echo.

:: Try release exe first, then debug
if exist "src-tauri\target\release\zenith-app.exe" (
    echo  [OK] Found release build.
    goto :launch_exe
)
if exist "src-tauri\target\debug\zenith-app.exe" (
    echo  [OK] Found debug build.
    start "" "src-tauri\target\debug\zenith-app.exe"
    goto :done
)

:: No build found — trigger a build
echo  [INFO] No build found. Building release...
echo.
goto :do_rebuild

:: ============================================================================
::  OPTION 3: Dev server (hot reload)
:: ============================================================================
:do_dev
echo.
echo  [DEV] Starting Zenith dev server...
echo  Press Ctrl+C to stop.
echo.

:: Install deps if needed
if not exist "node_modules\" (
    echo  Installing Node dependencies...
    call npm install
)
where python >nul 2>&1
if %errorlevel% equ 0 (
    pip install -r scripts\requirements.txt -q 2>nul
)

call npm run tauri dev
goto :done

:: ============================================================================
::  Launch the release exe
:: ============================================================================
:launch_exe
echo  Launching Zenith...
start "" "src-tauri\target\release\zenith-app.exe"
goto :done

:done
echo.
echo  Zenith started.
exit /b 0
