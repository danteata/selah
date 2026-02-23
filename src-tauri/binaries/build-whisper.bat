@echo off
REM Build script for creating standalone whisper-server executables on Windows
REM This creates platform-specific binaries that can be bundled with Tauri

set TARGET_TRIPLE=x86_64-pc-windows-msvc
set SCRIPT_DIR=%~dp0
set OUTPUT_DIR=%SCRIPT_DIR%

echo Building whisper-server for %TARGET_TRIPLE%...
echo Output directory: %OUTPUT_DIR%

REM Check for python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH.
    exit /b 1
)

REM Create a virtual environment and install dependencies
set VENV_DIR=%SCRIPT_DIR%.venv-build
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%"
python -m venv "%VENV_DIR%"
call "%VENV_DIR%\Scripts\activate"

REM Install dependencies
echo Installing dependencies...
python -m pip install --upgrade pip
pip install pyinstaller
pip install -r "%SCRIPT_DIR%requirements.txt"

REM Build with PyInstaller
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
rmdir /s /q "%SCRIPT_DIR%.build"
del "%SCRIPT_DIR%selah-whisper-server-%TARGET_TRIPLE%.spec"
call deactivate
rmdir /s /q "%VENV_DIR%"

echo.
echo Build complete!
echo Binary: %OUTPUT_DIR%selah-whisper-server-%TARGET_TRIPLE%.exe
dir "%OUTPUT_DIR%selah-whisper-server-*"
