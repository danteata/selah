#!/bin/bash
# Ensures the platform-specific whisper server sidecar binary exists.
# If missing, builds it automatically using build-whisper.sh.
#
# This script is meant to be run before `tauri dev` so the sidecar
# binary is always available for the current platform.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="${SCRIPT_DIR}/../src-tauri/binaries"

detect_target_triple() {
    local OS="$(uname -s)"
    local ARCH="$(uname -m)"
    case "$OS" in
        Linux*)
            if [ "$ARCH" = "aarch64" ]; then
                echo "aarch64-unknown-linux-gnu"
            else
                echo "x86_64-unknown-linux-gnu"
            fi
            ;;
        Darwin*)
            if [ "$ARCH" = "arm64" ]; then
                echo "aarch64-apple-darwin"
            else
                echo "x86_64-apple-darwin"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "x86_64-pc-windows-msvc"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

TARGET_TRIPLE="$(detect_target_triple)"
if [ "$TARGET_TRIPLE" = "unknown" ]; then
    echo "ERROR: Unsupported platform"
    exit 1
fi

BINARY_NAME="selah-whisper-server-${TARGET_TRIPLE}"
# On Windows, the binary has a .exe extension
if [[ "$TARGET_TRIPLE" == *"-windows-"* ]]; then
    BINARY_NAME="${BINARY_NAME}.exe"
fi

BINARY_PATH="${BINARIES_DIR}/${BINARY_NAME}"

if [ -f "$BINARY_PATH" ]; then
    echo "✓ Whisper sidecar binary exists: ${BINARY_NAME}"
    exit 0
fi

echo "⚠ Whisper sidecar binary not found: ${BINARY_NAME}"
echo "  Building from source..."

if [ -f "${BINARIES_DIR}/build-whisper.sh" ]; then
    bash "${BINARIES_DIR}/build-whisper.sh"
else
    echo "ERROR: build-whisper.sh not found at ${BINARIES_DIR}/"
    exit 1
fi

if [ -f "$BINARY_PATH" ]; then
    echo "✓ Whisper sidecar binary built successfully: ${BINARY_NAME}"
else
    echo "ERROR: Build completed but binary not found at ${BINARY_PATH}"
    exit 1
fi