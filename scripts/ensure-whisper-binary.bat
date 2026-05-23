@echo off
REM Ensures the whisper-server sidecar binary and _internal/ directory exist
REM in assets/whisper-server/ for Tauri resource bundling.
REM
REM Search order:
REM   1. assets\whisper-server\{binary} - already built (dev or CI)
REM   2. binaries\{binary}             - sidecar-only copy; needs _internal/ populated
REM   3. Build from source via build-whisper.bat

setlocal enabledelayedexpansion

set TARGET_TRIPLE=x86_64-pc-windows-msvc
set SCRIPT_DIR=%~dp0
set BINARIES_DIR=%SCRIPT_DIR%..\src-tauri\binaries
set ASSETS_DIR=%SCRIPT_DIR%..\src-tauri\assets\whisper-server
set BINARY_NAME=selah-whisper-server-%TARGET_TRIPLE%.exe
set ASSETS_BINARY=%ASSETS_DIR%\%BINARY_NAME%
set BINARIES_BINARY=%BINARIES_DIR%\%BINARY_NAME%

REM 1. Already in assets\whisper-server\ (best case)
if exist "%ASSETS_BINARY%" (
    echo [OK] Whisper sidecar binary exists: %BINARY_NAME%
    if not exist "%BINARIES_BINARY%" (
        if not exist "%BINARIES_DIR%" mkdir "%BINARIES_DIR%"
        copy /Y "%ASSETS_BINARY%" "%BINARIES_BINARY%" >nul
        echo     Linked to binaries\ for Tauri sidecar
    )
    exit /b 0
)

REM 2. In binaries\ but not in assets\ - copy binary + _internal\
if exist "%BINARIES_BINARY%" (
    echo [OK] Whisper sidecar binary exists in binaries\: %BINARY_NAME%
    if not exist "%ASSETS_DIR%" mkdir "%ASSETS_DIR%"
    copy /Y "%BINARIES_BINARY%" "%ASSETS_BINARY%" >nul

    set "ONEDIR_INTERNAL=%BINARIES_DIR%\dist\%BINARY_NAME%\_internal"
    if exist "%ONEDIR_INTERNAL%" (
        if not exist "%ASSETS_DIR%\_internal" (
            xcopy /E /I /Y "%ONEDIR_INTERNAL%" "%ASSETS_DIR%\_internal" >nul
            echo     Copied _internal\ to assets\whisper-server\
        )
    )

    set "LOCAL_INTERNAL=%BINARIES_DIR%\_internal"
    if exist "%LOCAL_INTERNAL%" (
        if not exist "%ASSETS_DIR%\_internal" (
            xcopy /E /I /Y "%LOCAL_INTERNAL%" "%ASSETS_DIR%\_internal" >nul
            echo     Copied _internal\ to assets\whisper-server\
        )
    )

    if not exist "%ASSETS_DIR%\_internal" (
        echo     Note: No _internal\ directory found (binary may be standalone^)
    )
    exit /b 0
)

REM 3. Build from source
echo [!] Whisper sidecar binary not found: %BINARY_NAME%
echo     Building from source...

if exist "%BINARIES_DIR%\build-whisper.bat" (
    call "%BINARIES_DIR%\build-whisper.bat"
) else (
    echo ERROR: build-whisper.bat not found at %BINARIES_DIR%\
    exit /b 1
)

if exist "%ASSETS_BINARY%" (
    echo [OK] Whisper sidecar binary built successfully: %BINARY_NAME%
) else if exist "%BINARIES_BINARY%" (
    echo [OK] Whisper sidecar binary built in binaries\: %BINARY_NAME%
) else (
    echo ERROR: Build completed but binary not found
    echo     Checked: %ASSETS_BINARY%
    echo     Checked: %BINARIES_BINARY%
    exit /b 1
)

endlocal