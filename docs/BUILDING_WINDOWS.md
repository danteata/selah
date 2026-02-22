# Building Selah Desktop for Windows from WSL2

This guide explains how to build the Selah desktop app for Windows while developing in WSL2.

## ⚠️ Important: UNC Paths Not Supported

**Windows batch scripts cannot run from WSL UNC paths** (`\\wsl$\Ubuntu\...`). You have two options:

### Option A: Copy project to Windows drive (Recommended)

```powershell
# Copy project to Windows drive
xcopy /E /I "\\wsl$\Ubuntu\home\daniel\code\selah" "C:\dev\selah"

# Navigate to Windows location
cd C:\dev\selah

# Run build
.\scripts\build-windows.bat
```

### Option B: Map WSL path to drive letter

```powershell
# Map WSL path to a drive letter (e.g., W:)
net use W: "\\wsl$\Ubuntu\home\daniel\code\selah"

# Navigate to mapped drive
cd W:\

# Run build
.\scripts\build-windows.bat
```

## Option 1: Cross-Compilation from WSL2 (Recommended)

Cross-compiling from Linux to Windows requires the mingw-w64 toolchain.

### 1. Install Cross-Compilation Tools

```bash
# In WSL2
sudo apt update
sudo apt install mingw-w64
```

### 2. Add Rust Windows Target

```bash
# Add the Windows target to Rust
rustup target add x86_64-pc-windows-gnu
```

### 3. Configure Cargo for Cross-Compilation

Create or edit `~/.cargo/config.toml`:

```toml
[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
ar = "x86_64-w64-mingw32-gcc-ar"
```

### 4. Build for Windows

```bash
# Build the frontend first
bun run build

# Build Tauri for Windows
bun run tauri build --target x86_64-pc-windows-gnu
```

**Note:** Cross-compilation has limitations:
- Some native libraries may not work correctly
- The `screencapturekit` crate (macOS only) won't affect Windows builds
- Windows-specific features (WASAPI) need testing on actual Windows

## Option 2: Build natively on Windows (Most Reliable)

For the most reliable Windows build, run the build process natively on Windows.

### 1. Open PowerShell (not WSL)

Open a native Windows PowerShell terminal.

### 2. Install Prerequisites (if not already installed)

```powershell
# Install Rust (if not installed)
winget install Rustlang.Rustup

# Install bun (if not installed)
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 3. Navigate to Project

```powershell
# Navigate to your project (access WSL filesystem from Windows)
cd \\wsl$\Ubuntu\home\daniel\code\selah
```

Or if your project is on the Windows filesystem:

```powershell
cd C:\path\to\selah
```

### 4. Run the Build Script

```powershell
# Run the Windows build script
.\scripts\build-windows.bat
```

Or manually:

```powershell
# Install dependencies
bun install

# Build frontend
bun run build

# Build Tauri for Windows
bun run tauri build
```

### 5. Find the Output

The built installers will be in:
- MSI installer: `src-tauri\target\release\bundle\msi\`
- NSIS installer: `src-tauri\target\release\bundle\nsis\`

## Option 3: Use VS Code Remote

VS Code can connect to both WSL and Windows, making it easy to run builds in either environment.

### 1. Open Project in Windows

From VS Code:
1. Press `F1` or `Ctrl+Shift+P`
2. Select "Remote-SSH: Connect to Host" or "WSL: Reopen Folder in Windows"
3. Navigate to your project

### 2. Open Integrated Terminal

The terminal will run in the Windows environment.

### 3. Run Build Commands

```powershell
bun install
bun run build
bun run tauri build
```

## Development Testing

### Run Dev Server

For development testing without building:

```bash
# In WSL2 (for development)
bun run tauri dev
```

This runs the app in development mode with hot-reload.

### Test Specific Features

To test Windows-specific audio capture features:

1. Build and run on Windows natively
2. Check that `is_system_audio_supported()` returns `true`
3. Test system audio capture with the sermon listener

## Troubleshooting

### "linker 'x86_64-w64-mingw32-gcc' not found"

Install mingw-w64:
```bash
sudo apt install mingw-w64
```

### "cargo not found" on Windows

Install Rust on Windows:
```powershell
winget install Rustlang.Rustup
```

### Build fails with Windows API errors

Some Windows features require building natively on Windows. Use Option 2.

### WSL filesystem access is slow

If your project is on the WSL filesystem (`\\wsl$\Ubuntu\...`), builds may be slow. Consider:
1. Moving the project to the Windows filesystem (`C:\dev\selah`)
2. Or building from WSL with cross-compilation

## Quick Reference

| Task | Command |
|------|---------|
| Dev mode (WSL) | `bun run tauri dev` |
| Build Linux | `bun run tauri build` |
| Build Windows (cross) | `bun run tauri build --target x86_64-pc-windows-gnu` |
| Build Windows (native) | Run `build-windows.bat` in PowerShell |

## CI/CD for Windows Builds

For automated Windows builds, consider using GitHub Actions:

```yaml
# .github/workflows/build-windows.yml
name: Build Windows

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        
      - name: Install dependencies
        run: bun install
        
      - name: Build
        run: bun run tauri build
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: src-tauri/target/release/bundle/
```
