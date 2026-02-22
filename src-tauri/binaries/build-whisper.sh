#!/bin/bash
# Build script for creating standalone whisper-server executables
# This creates platform-specific binaries that can be bundled with Tauri

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}"

# Detect platform and architecture for Tauri target triple naming
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux*)
        if [ "$ARCH" = "aarch64" ]; then
            TARGET_TRIPLE="aarch64-unknown-linux-gnu"
        else
            TARGET_TRIPLE="x86_64-unknown-linux-gnu"
        fi
        ;;
    Darwin*)
        if [ "$ARCH" = "arm64" ]; then
            TARGET_TRIPLE="aarch64-apple-darwin"
        else
            TARGET_TRIPLE="x86_64-apple-darwin"
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*)
        TARGET_TRIPLE="x86_64-pc-windows-msvc"
        ;;
    *)
        echo "Unknown platform: $OS"
        exit 1
        ;;
esac

echo "Building whisper-server for $TARGET_TRIPLE..."
echo "Output directory: $OUTPUT_DIR"

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
    --name "selah-whisper-server-${TARGET_TRIPLE}" \
    --distpath "$OUTPUT_DIR" \
    --workpath "${SCRIPT_DIR}/.build" \
    --specpath "${SCRIPT_DIR}" \
    --clean \
    "${SCRIPT_DIR}/whisper-server.py"

# Cleanup
rm -rf "${SCRIPT_DIR}/.build"
rm -rf "${SCRIPT_DIR}/selah-whisper-server-${TARGET_TRIPLE}.spec"
deactivate
rm -rf "$VENV_DIR"

echo ""
echo "Build complete!"
echo "Binary: ${OUTPUT_DIR}/selah-whisper-server-${TARGET_TRIPLE}"
ls -la "$OUTPUT_DIR"/selah-whisper-server-*
