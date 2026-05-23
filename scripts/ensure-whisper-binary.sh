#!/usr/bin/env bash
# Ensures the whisper-server sidecar binary and _internal/ directory exist
# in assets/whisper-server/ for Tauri resource bundling.
#
# Search order:
#   1. assets/whisper-server/{binary} — already built (dev or CI)
#   2. binaries/{binary}               — sidecar-only copy; needs _internal/ populated
#   3. Build from source via build-whisper.sh
#
# This script is called by desktop:prebuild before `tauri dev`.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="${SCRIPT_DIR}/../src-tauri/binaries"
ASSETS_DIR="${SCRIPT_DIR}/../src-tauri/assets/whisper-server"

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

ASSETS_BINARY="${ASSETS_DIR}/${BINARY_NAME}"
BINARIES_BINARY="${BINARIES_DIR}/${BINARY_NAME}"

# 1. Already in assets/whisper-server/ (best case: dev build or CI artifact)
if [ -f "$ASSETS_BINARY" ]; then
    echo "✓ Whisper sidecar binary exists: ${BINARY_NAME}"
    # Also link to binaries/ for Tauri sidecar resolution
    if [ ! -f "$BINARIES_BINARY" ]; then
        mkdir -p "$BINARIES_DIR"
        cp "$ASSETS_BINARY" "$BINARIES_BINARY"
        echo "  Linked to binaries/ for Tauri sidecar"
    fi
    exit 0
fi

# 2. In binaries/ but not in assets/ — copy binary + _internal/ over
if [ -f "$BINARIES_BINARY" ]; then
    echo "✓ Whisper sidecar binary exists in binaries/: ${BINARY_NAME}"
    mkdir -p "$ASSETS_DIR"
    cp "$BINARIES_BINARY" "$ASSETS_BINARY"

    # Copy _internal/ from the PyInstaller onedir output if it exists
    ONEDIR_INTERNAL="${BINARIES_DIR}/dist/${BINARY_NAME}/_internal"
    if [ -d "$ONEDIR_INTERNAL" ] && [ ! -d "${ASSETS_DIR}/_internal" ]; then
        cp -R "$ONEDIR_INTERNAL" "${ASSETS_DIR}/"
        echo "  Copied _internal/ to assets/whisper-server/"
    fi

    # Also check for _internal/ directly in binaries/ (some build setups)
    LOCAL_INTERNAL="${BINARIES_DIR}/_internal"
    if [ -d "$LOCAL_INTERNAL" ] && [ ! -d "${ASSETS_DIR}/_internal" ]; then
        cp -R "$LOCAL_INTERNAL" "${ASSETS_DIR}/"
        echo "  Copied _internal/ to assets/whisper-server/"
    fi

    # If _internal/ is still missing, the binary may not need it (standalone build)
    if [ ! -d "${ASSETS_DIR}/_internal" ]; then
        echo "  Note: No _internal/ directory found (binary may be standalone)"
    fi
    exit 0
fi

# 3. Build from source
echo "⚠ Whisper sidecar binary not found: ${BINARY_NAME}"
echo "  Building from source..."

if [ -f "${BINARIES_DIR}/build-whisper.sh" ]; then
    bash "${BINARIES_DIR}/build-whisper.sh"
else
    echo "ERROR: build-whisper.sh not found at ${BINARIES_DIR}/"
    exit 1
fi

if [ -f "$ASSETS_BINARY" ]; then
    echo "✓ Whisper sidecar binary built successfully: ${BINARY_NAME}"
elif [ -f "$BINARIES_BINARY" ]; then
    echo "✓ Whisper sidecar binary built in binaries/: ${BINARY_NAME}"
else
    echo "ERROR: Build completed but binary not found"
    echo "  Checked: ${ASSETS_BINARY}"
    echo "  Checked: ${BINARIES_BINARY}"
    exit 1
fi