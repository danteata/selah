@echo off
REM Build script for Windows desktop app
REM This script builds the Tauri app for Windows

echo Building Selah Desktop App for Windows...

REM Check if Rust is installed
where rustc >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Rust is not installed. Please install from https://rustup.rs/
    exit /b 1
)

REM Check if bun is installed
where bun >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: Bun is not installed. Please install from https://bun.sh/
    exit /b 1
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    bun install
)

REM Build the frontend
echo Building frontend...
bun run build

REM Build Tauri app for Windows
echo Building Tauri app...
bun run tauri build --target x86_64-pc-windows-msvc

echo.
echo Build complete! 
echo The installer can be found in: src-tauri\target\release\bundle\
echo.
echo Generated files:
echo   - MSI installer: src-tauri\target\release\bundle\msi\
echo   - NSIS installer: src-tauri\target\release\bundle\nsis\
