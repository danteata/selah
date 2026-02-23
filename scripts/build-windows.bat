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

REM Detect package manager (prefer bun, fallback to npm)
where bun >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set "PKG_MANAGER=bun"
    echo Using bun as package manager
) else (
    where npm >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        set "PKG_MANAGER=npm"
        echo Using npm as package manager (bun not found)
    ) else (
        echo Error: Neither bun nor npm is installed. Please install one of them.
        exit /b 1
    )
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    if "%PKG_MANAGER%"=="bun" (
        bun install
    ) else (
        npm install
    )
)

REM Build the frontend
echo Building frontend...
if "%PKG_MANAGER%"=="bun" (
    bun run build
) else (
    npm run build
)

REM Build Tauri app for Windows
echo Building Tauri app...
if "%PKG_MANAGER%"=="bun" (
    bun run tauri build --target x86_64-pc-windows-msvc
) else (
    npm run tauri build -- --target x86_64-pc-windows-msvc
)

echo.
echo Build complete! 
echo The installer can be found in: src-tauri\target\release\bundle\
echo.
echo Generated files:
echo   - MSI installer: src-tauri\target\release\bundle\msi\
echo   - NSIS installer: src-tauri\target\release\bundle\nsis\
