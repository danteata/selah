#!/bin/bash
# Build script for creating standalone whisper-server executables
# This creates platform-specific binaries that can be bundled with Tauri

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/dist"

# Detect platform
OS="$(uname -s)"
case "$OS" in
    Linux*)
        PLATFORM="linux"
        ;;
    Darwin*)
        PLATFORM="macos"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="windows"
        ;;
    *)
        echo "Unknown platform: $OS"
        exit 1
        ;;
esac

echo "Building whisper-server for $PLATFORM..."
echo "Output directory: $OUTPUT_DIR"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Create a virtual environment and install dependencies
VENV_DIR="${SCRIPT_DIR}/.venv-build"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

# Install dependencies
pip install --upgrade pip
pip install pyinstaller
pip install -r "${SCRIPT_DIR}/requirements.txt"

# Build with PyInstaller
pyinstaller \
    --onefile \
    --name "selah-whisper-server-${PLATFORM}" \
    --distpath "$OUTPUT_DIR" \
    --workpath "${SCRIPT_DIR}/.build" \
    --specpath "${SCRIPT_DIR}" \
    --clean \
    "${SCRIPT_DIR}/whisper-server.py"

# Cleanup
rm -rf "${SCRIPT_DIR}/.build"
rm -rf "${SCRIPT_DIR}/selah-whisper-server-${PLATFORM}.spec"
deactivate
rm -rf "$VENV_DIR"

echo ""
echo "Build complete!"
echo "Binary: ${OUTPUT_DIR}/selah-whisper-server-${PLATFORM}"
ls -la "$OUTPUT_DIR"
