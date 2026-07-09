# Build Instructions

How to set up the dev environment and build Selah — web and desktop.

Transcription on desktop runs **entirely in-process** via the native engine
(`transcribe-rs`: whisper.cpp for Whisper GGUF models + ONNX Runtime for
Parakeet/Canary/Cohere/etc.). There is **no Python sidecar** — so the desktop
build compiles whisper.cpp from source and therefore needs a C/C++ toolchain
and **CMake**.

## Prerequisites

### All platforms

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)
- A [Convex](https://convex.dev/) account (transcripts, settings, auth backend)
- A [Clerk](https://clerk.com/) account (authentication)

### Desktop builds (Tauri) — additional

- [Rust](https://rustup.rs/) (latest stable)
- **CMake** ≥ 3.18 — required to compile whisper.cpp
- A C/C++ compiler toolchain (see per-platform notes)
- Tauri's platform dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

#### macOS
```bash
xcode-select --install        # Command Line Tools (clang)
brew install cmake
```
GPU acceleration uses **Metal** (enabled automatically).

#### Linux
```bash
sudo apt install -y cmake build-essential libssl-dev libasound2-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```
GPU acceleration uses **Vulkan** (install your distro's Vulkan loader/ICD).

#### Windows
- Visual Studio Build Tools (MSVC, "Desktop development with C++")
- CMake: `winget install Kitware.CMake`
- Ninja: `winget install Ninja-build.Ninja` (or `choco install ninja`)

GPU acceleration uses **Vulkan + DirectML**. The Vulkan backend builds a nested
CMake sub-project (`vulkan-shaders-gen`) that trips up two Windows-specific
issues, both worked around in CI (see `.github/workflows/build-desktop.yml`):

1. **Wrong generator** — the default Visual Studio generator re-invokes the
   nested project's configure step *without* the VS toolset context, failing
   with `No CMAKE_C_COMPILER could be found`. The **Ninja** generator doesn't
   have this problem (it picks up `cl.exe` from `PATH` directly).
2. **MAX_PATH (260 chars)** — `vulkan-shaders-gen`'s nested build directories
   are deeply nested (`...\ggml-vulkan\vulkan-shaders-gen-prefix\src\
   vulkan-shaders-gen-build\CMakeFiles\...`). Combined with a normal project
   checkout path, generated file paths blow past 260 characters and MSBuild's
   `GetOutOfDateItems` fails with a path-length error. A **short**
   `CARGO_TARGET_DIR` keeps every nested path under the limit.

Set these as **permanent** environment variables (not `$env:...`, which only
lasts for the current terminal session and is lost on restart — this is a
common source of "it worked yesterday" confusion):
```powershell
setx CMAKE_GENERATOR "Ninja"
setx CARGO_TARGET_DIR "C:\st"
```
Then **fully close and reopen** your terminal/IDE (`setx` only affects new
processes) and build from a shell with the MSVC dev environment loaded (the
**Developer Command Prompt/PowerShell for VS**, or run `vcvarsall.bat x64`
first) so `cl.exe` is on `PATH`.

## Setup

```bash
git clone https://github.com/danteata/selah.git
cd selah
bun install            # or: npm install
```

Create `.env.local`:
```env
VITE_CONVEX_URL=your_convex_deployment_url
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
```

Run the Convex dev backend in a separate terminal:
```bash
bunx convex dev
```

## Web dev

```bash
bun run dev            # Vite dev server (no Rust/CMake needed)
```

## Desktop dev

```bash
bun run desktop:dev    # downloads model assets, then runs `tauri dev`
```

`desktop:prebuild` (run automatically by `desktop:dev`) downloads:
- the bundled **GGUF `base.en`** Whisper model (`scripts/download-gguf-model.mjs`) — the offline default,
- the local embedding model + verse-embedding pack (semantic verse detection).

The native transcription engine is compiled by default (the `native-transcription`
Cargo feature is in `default`). The first desktop build is slow because it
compiles whisper.cpp + ONNX Runtime; subsequent builds are incremental.

### Models

- `base.en` is **bundled** and works fully offline.
- Larger/multilingual models (Whisper Small/Medium/Turbo/Large, Parakeet V2/V3,
  Moonshine, SenseVoice, GigaAM, Canary, Cohere) download on demand from the
  in-app model picker (**Settings → Sermon Listener → Transcription model**),
  verified against pinned SHA-256 hashes.

> Production note: downloadable model artifacts currently come from a public CDN
> (`blob.handy.computer`). Mirror them to Selah-controlled storage before
> shipping; the pinned hashes are host-independent.

## Production builds

```bash
bun run desktop:build              # current platform
bun run desktop:build:mac          # universal macOS
bun run desktop:build:windows      # Windows MSVC
bun run desktop:build:linux        # Linux
```

Optional features:
```bash
bun run desktop:build:ndi          # NDI video output (--features ndi)
```

## Verifying changes

```bash
bun run test                                   # unit tests (vitest)
npx tsc -p tsconfig.app.json --noEmit          # frontend typecheck
cd src-tauri && cargo check                    # Rust (native engine builds here)
```

## Troubleshooting

- **`is cmake not installed?` / whisper-rs-sys build fails** — install CMake
  (`brew install cmake` / `winget install Kitware.CMake` / `apt install cmake`).
- **Windows: `CMake Error: CMake was unable to find a build program
  corresponding to "Ninja"`** — `CMAKE_GENERATOR=Ninja` is set (required for
  the Vulkan backend, see above) but `ninja.exe` isn't on `PATH` for the
  process running the build. Install it (`winget install Ninja-build.Ninja`),
  then verify with `ninja --version` in a **brand-new** terminal window. If
  that works but the build still fails, the app you're launching
  `desktop:dev` from (VS Code, a terminal app, etc.) was already running
  before Ninja was installed and is still holding the old `PATH` — opening a
  new tab/panel inside it isn't enough. Fully quit and reopen that app, then
  retry.
- **Windows: MSBuild `GetOutOfDateItems` fails with "exceeds the OS max path
  limit"** — the nested `vulkan-shaders-gen` sub-build's paths blew past the
  260-char `MAX_PATH` limit. Set a short `CARGO_TARGET_DIR` (e.g. `C:\st`) and
  `CMAKE_GENERATOR=Ninja` as **permanent** env vars via `setx` (see Windows
  prerequisites above), then fully restart your terminal/IDE before retrying.
- **First build is very slow** — expected; whisper.cpp + ONNX Runtime compile
  once, then cache in `src-tauri/target` (or `%CARGO_TARGET_DIR%` on Windows).
- **Disk usage** — the target dir can grow to several GB. `cargo clean` (or
  remove `target/release`) to reclaim space.
