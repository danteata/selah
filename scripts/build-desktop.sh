#!/bin/bash
# Build script for desktop app
# This script builds the Tauri app for the current platform

set -e

echo "Building Selah Desktop App..."

# Check if Rust is installed
if ! command -v rustc &> /dev/null; then
    echo "Error: Rust is not installed. Please install from https://rustup.rs/"
    exit 1
fi

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed. Please install from https://bun.sh/"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    bun install
fi

# Detect platform
OS="$(uname -s)"
case "$OS" in
    Linux*)
        # Check for required Linux dependencies
        if ! dpkg -l | grep -q libwebkit2gtk-4.1-dev; then
            echo "Warning: libwebkit2gtk-4.1-dev may not be installed."
            echo "If the build fails, run: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev"
        fi
        ;;
    Darwin*)
        echo "Building for macOS..."
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "Building for Windows..."
        ;;
esac

# Build the frontend
echo "Building frontend..."
bun run build

# Build Tauri app
echo "Building Tauri app..."
bun run tauri build

echo ""
echo "Build complete!"
echo "The installer can be found in: src-tauri/target/release/bundle/"
echo ""

# Show generated files based on platform
case "$OS" in
    Linux*)
        echo "Generated files:"
        echo "  - DEB package: src-tauri/target/release/bundle/deb/"
        echo "  - AppImage: src-tauri/target/release/bundle/appimage/"
        ;;
    Darwin*)
        echo "Generated files:"
        echo "  - DMG: src-tauri/target/release/bundle/dmg/"
        echo "  - App bundle: src-tauri/target/release/bundle/macos/"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        echo "Generated files:"
        echo "  - MSI installer: src-tauri/target/release/bundle/msi/"
        echo "  - NSIS installer: src-tauri/target/release/bundle/nsis/"
        ;;
esac
