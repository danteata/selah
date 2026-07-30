#!/usr/bin/env sh
# Dev run without the native transcription engine.
#
# `tauri dev` can't do this. The CLI builds cargo's feature list from the crate's
# default features (minus custom-protocol, which is release-only) and offers no
# way to subtract one — `--features` only adds, and cargo unions repeated
# `--features` flags. So native-transcription is always on, which drags in
# transcribe-cpp and its CMake build of ggml's Vulkan backend. On a machine
# without LunarG's vulkan-sdk that fails at configure time with:
#
#   Could NOT find Vulkan (missing: Vulkan_LIBRARY Vulkan_INCLUDE_DIR glslc)
#
# Running the two halves ourselves is the only way to leave the feature out. The
# app still reads build.devUrl from tauri.conf.json, so a plain `cargo run`
# attaches to the Vite server exactly as `tauri dev` would — it just doesn't
# watch and rebuild Rust on change.
#
# The sermon listener is absent in this mode. Everything else, NDI included, works.
#
# On a Wayland session, prefix with GDK_BACKEND=x11 if you want to exercise NDI
# output: it captures an X11 window, and a natively-Wayland window has none.
set -e

PORT=3000
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

cleanup() {
    if [ -n "$VITE_PID" ]; then
        kill "$VITE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

# Two runtime libraries the app dlopens, warned about here because the failures
# are otherwise cryptic: a panic from inside libappindicator-sys before any
# window appears, and NDI silently reporting itself unavailable.
if ! ldconfig -p 2>/dev/null | grep -q 'libayatana-appindicator3\.so\.1\|libappindicator3\.so\.1'; then
    echo "warning: no libayatana-appindicator3.so.1 on this system. Tauri's tray-icon"
    echo "         feature loads it at startup and panics without it:"
    echo "           sudo apt-get install -y libayatana-appindicator3-1"
fi
if [ -z "$NDI_RUNTIME_DIR_V6" ] && ! ldconfig -p 2>/dev/null | grep -q 'libndi'; then
    echo "note: no NDI runtime on the library path, so NDI output will report itself"
    echo "      unavailable. Point NDI_RUNTIME_DIR_V6 at the SDK's lib directory to test it."
fi

npm run dev &
VITE_PID=$!

printf 'waiting for the dev server on :%s' "$PORT"
tries=0
while ! curl -sf "http://localhost:$PORT" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -gt 120 ]; then
        printf ' — gave up after 60s\n'
        exit 1
    fi
    printf '.'
    sleep 0.5
done
printf ' ready\n'

cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --features ndi
