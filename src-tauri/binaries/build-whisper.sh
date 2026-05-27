#!/bin/bash
# Build script for creating standalone whisper-server executables
# Uses PyInstaller --onedir for fast startup (no /tmp extraction, no Gatekeeper tax).
# The output directory is copied to src-tauri/assets/whisper-server/ for Tauri bundling.
#
# Binaries must follow Tauri's naming convention:
#   selah-whisper-server-{target-triple}
#
# And be placed in src-tauri/assets/whisper-server/ for resource bundling.

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

BINARY_NAME="selah-whisper-server-${TARGET_TRIPLE}"
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

# Build with --onedir for fast startup (no /tmp extraction on macOS)
pyinstaller \
    --onedir \
    --name "$BINARY_NAME" \
    --distpath "$OUTPUT_DIR" \
    --workpath "${SCRIPT_DIR}/.build" \
    --specpath "${SCRIPT_DIR}" \
    --clean \
    "${SCRIPT_DIR}/whisper-server.py"

# Copy the --onedir output to Tauri assets for resource bundling
ASSETS_DIR="${SCRIPT_DIR}/../assets/whisper-server"
rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
cp -R "${OUTPUT_DIR}/${BINARY_NAME}/" "$ASSETS_DIR/"

# Also copy the main binary to the binaries/ directory for the prebuild check
# and Tauri sidecar resolution. This is just the main executable, not the
# full --onedir output (which goes to assets/).
cp "${ASSETS_DIR}/${BINARY_NAME}" "${SCRIPT_DIR}/${BINARY_NAME}"

# Cleanup build artifacts (but not the binaries/ copy)
rm -rf "${SCRIPT_DIR}/.build"
rm -rf "${SCRIPT_DIR}/${BINARY_NAME}.spec"
rm -rf "${OUTPUT_DIR}/${BINARY_NAME}"
deactivate
rm -rf "$VENV_DIR"

echo ""
echo "Build complete!"
echo "Binary: ${ASSETS_DIR}/${BINARY_NAME}"
ls -la "${ASSETS_DIR}/${BINARY_NAME}"
