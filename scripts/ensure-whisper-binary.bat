@echo off
REM Ensures the platform-specific whisper server sidecar binary exists.
REM If missing, builds it automatically using build-whisper.bat.

setlocal enabledelayedexpansion

set TARGET_TRIPLE=x86_64-pc-windows-msvc
set SCRIPT_DIR=%~dp0
set BINARIES_DIR=%SCRIPT_DIR%..\src-tauri\binaries
set BINARY_NAME=selah-whisper-server-%TARGET_TRIPLE%.exe
set BINARY_PATH=%BINARIES_DIR%\%BINARY_NAME%

if exist "%BINARY_PATH%" (
    echo [OK] Whisper sidecar binary exists: %BINARY_NAME%
    exit /b 0
)

echo [!] Whisper sidecar binary not found: %BINARY_NAME%
echo     Building from source...

if exist "%BINARIES_DIR%\build-whisper.bat" (
    call "%BINARIES_DIR%\build-whisper.bat"
) else (
    echo ERROR: build-whisper.bat not found at %BINARIES_DIR%\
    exit /b 1
)

if exist "%BINARY_PATH%" (
    echo [OK] Whisper sidecar binary built successfully: %BINARY_NAME%
) else (
    echo ERROR: Build completed but binary not found at %BINARY_PATH%
    exit /b 1
)

endlocal