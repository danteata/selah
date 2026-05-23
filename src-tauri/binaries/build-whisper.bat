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
REM Build with PyInstaller --onedir for fast startup (no /tmp extraction).
REM The output directory is copied to assets/whisper-server/ for Tauri bundling.
echo Running PyInstaller...
pyinstaller ^
    --onedir ^
    --name "selah-whisper-server-%TARGET_TRIPLE%" ^
    --distpath "%OUTPUT_DIR%" ^
    --workpath "%SCRIPT_DIR%.build" ^
    --specpath "%SCRIPT_DIR%." ^
    --clean ^
    "%SCRIPT_DIR%whisper-server.py"

REM Copy the --onedir output to Tauri assets for resource bundling
set ASSETS_DIR=%SCRIPT_DIR%..\src-tauri\assets\whisper-server
if not exist "%ASSETS_DIR%" mkdir "%ASSETS_DIR%"
xcopy /E /I /Y "%OUTPUT_DIR%\selah-whisper-server-%TARGET_TRIPLE%\*" "%ASSETS_DIR%\"

REM Also copy the main binary to binaries/ for the prebuild check
copy /Y "%ASSETS_DIR%\selah-whisper-server-%TARGET_TRIPLE%.exe" "%OUTPUT_DIR%\selah-whisper-server-%TARGET_TRIPLE%.exe" >nul

REM Cleanup build artifacts (keep the binaries/ copy and assets/ output)
if exist "%SCRIPT_DIR%.build" rmdir /s /q "%SCRIPT_DIR%.build"
if exist "%SCRIPT_DIR%selah-whisper-server-%TARGET_TRIPLE%.spec" del "%SCRIPT_DIR%selah-whisper-server-%TARGET_TRIPLE%.spec"
if exist "%OUTPUT_DIR%\selah-whisper-server-%TARGET_TRIPLE%" rmdir /s /q "%OUTPUT_DIR%\selah-whisper-server-%TARGET_TRIPLE%"
call deactivate
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"

echo.
echo Build complete!
echo Binary: %ASSETS_DIR%\selah-whisper-server-%TARGET_TRIPLE%.exe
dir "%ASSETS_DIR%\selah-whisper-server-*.exe"
