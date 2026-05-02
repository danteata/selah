@echo off
REM Build script for creating standalone whisper-server executables on Windows
REM This creates platform-specific binaries for the Tauri sidecar (externalBin).
REM
REM Binaries must follow Tauri's naming convention:
REM   selah-whisper-server-{target-triple}
REM
REM And be placed in src-tauri/binaries/ for the externalBin config to find them.

set TARGET_TRIPLE=x86_64-pc-windows-msvc
set SCRIPT_DIR=%~dp0
set OUTPUT_DIR=%SCRIPT_DIR%

echo Building whisper-server for %TARGET_TRIPLE%...
echo Output directory: %OUTPUT_DIR%

REM Check for uv (preferred) or python
uv --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Using uv for dependency management...
    goto :use_uv
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Using python for dependency management...
    goto :use_python
)

echo Error: Neither uv nor Python is installed or in PATH.
echo Please install uv from https://docs.astral.sh/uv/ or Python 3.8+
exit /b 1

:use_uv
REM Create a virtual environment and install dependencies using uv
set VENV_DIR=%SCRIPT_DIR%.venv-build
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"

echo Creating virtual environment with uv...
uv venv "%VENV_DIR%"
call "%VENV_DIR%\Scripts\activate"

echo Installing dependencies with uv...
uv pip install pyinstaller
uv pip install -r "%SCRIPT_DIR%requirements.txt"

goto :build

:use_python
REM Create a virtual environment and install dependencies using python
set VENV_DIR=%SCRIPT_DIR%.venv-build
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"
python -m venv "%VENV_DIR%"
call "%VENV_DIR%\Scripts\activate"

echo Installing dependencies with pip...
python -m pip install --upgrade pip
pip install pyinstaller
pip install -r "%SCRIPT_DIR%requirements.txt"

goto :build

:build
REM Build with PyInstaller — output goes directly into binaries/ (Tauri sidecar location)
echo Running PyInstaller...
pyinstaller ^
    --onefile ^
    --name "selah-whisper-server-%TARGET_TRIPLE%" ^
    --distpath "%OUTPUT_DIR%." ^
    --workpath "%SCRIPT_DIR%.build" ^
    --specpath "%SCRIPT_DIR%." ^
    --clean ^
    "%SCRIPT_DIR%whisper-server.py"

REM Cleanup
echo Cleaning up...
if exist "%SCRIPT_DIR%.build" rmdir /s /q "%SCRIPT_DIR%.build"
if exist "%SCRIPT_DIR%selah-whisper-server-%TARGET_TRIPLE%.spec" del "%SCRIPT_DIR%selah-whisper-server-%TARGET_TRIPLE%.spec"
call deactivate
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"

echo.
echo Build complete!
echo Binary: %OUTPUT_DIR%selah-whisper-server-%TARGET_TRIPLE%.exe
dir "%OUTPUT_DIR%selah-whisper-server-*"
