# Selah Desktop App

This is the Tauri-based desktop application for Selah - Church Presentation Software.

## Prerequisites

### For Development

1. **Node.js** (v18 or later) and **Bun** package manager
2. **Rust** (latest stable version) - [Install Rust](https://rustup.rs/)
3. **Platform-specific dependencies**:

#### Windows
- Microsoft Visual Studio C++ Build Tools
- Microsoft Edge Webview2 (included in Windows 10/11)

#### macOS
- Xcode Command Line Tools: `xcode-select --install`

#### Linux
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

## Development

```bash
# Install dependencies
bun install

# Start development server with Tauri
bun run tauri:dev
```

## Building for Production

### Build for current platform
```bash
bun run tauri:build
```

### Build for Windows specifically
```bash
bun run tauri:build --target x86_64-pc-windows-msvc
```

The built installers will be in `src-tauri/target/release/bundle/`.

## Output Formats

Tauri generates multiple installer formats:

### Windows
- `.msi` - Windows Installer package
- `.exe` - NSIS installer (self-contained)

### macOS
- `.dmg` - Disk image
- `.app` - Application bundle

### Linux
- `.deb` - Debian/Ubuntu package
- `.AppImage` - Universal Linux package

## Project Structure

```
selah/
├── src/                    # React frontend source
├── src-tauri/              # Tauri/Rust backend
│   ├── src/
│   │   └── main.rs         # Rust entry point
│   ├── icons/              # App icons for all platforms
│   ├── capabilities/       # Tauri security capabilities
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── src/platform/           # Platform abstraction layer
│   ├── index.ts            # Platform detection & export
│   ├── types.ts            # Platform interface types
│   ├── web.ts              # Web platform implementation
│   └── tauri.ts            # Tauri platform implementation
└── package.json            # Node.js dependencies & scripts
```

## Platform Abstraction

The app uses a platform abstraction layer that allows the same codebase to work in both web browsers and as a desktop app:

```typescript
import { platform, isDesktop, isWeb } from '@/platform';

// Check environment
if (isDesktop()) {
  // Desktop-specific features
}

// Use platform features
if (platform.filesystem.isAvailable) {
  const content = await platform.filesystem.readFile('/path/to/file');
}

if (platform.dialog.isAvailable) {
  const path = await platform.dialog.save({
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
}
```

## Features

- **Native File System Access**: Read/write files directly on the user's computer
- **Native Dialogs**: Open/save file dialogs, message boxes
- **Auto-Update**: Built-in update mechanism (requires configuration)
- **Window Controls**: Minimize, maximize, close programmatically
- **Cross-Platform**: Single codebase for Windows, macOS, and Linux

## Configuration

Edit `src-tauri/tauri.conf.json` to customize:
- App name and identifier
- Window size and behavior
- Security policies
- Bundle settings

## Troubleshooting

### Build fails on Windows
- Ensure Visual Studio Build Tools are installed
- Run `rustup target add x86_64-pc-windows-msvc`

### Build fails on Linux
- Install all required system dependencies
- Check that `pkg-config` is installed

### Development server won't start
- Check that port 3000 is not in use
- Try deleting `node_modules` and running `bun install` again
