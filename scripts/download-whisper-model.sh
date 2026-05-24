#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/assets/whisper-models"
BASE_EN_DIR="$MODELS_DIR/base.en"
HF_REPO="Systran/faster-whisper-base.en"
BRANCH="main"

FILES=(
    "model.bin"
    "tokenizer.json"
    "vocabulary.txt"
    "config.json"
)

mkdir -p "$BASE_EN_DIR"

all_exist=true
for f in "${FILES[@]}"; do
    if [ ! -f "$BASE_EN_DIR/$f" ]; then
        all_exist=false
        break
    fi
done

if $all_exist; then
    echo "Whisper base.en model already exists at $BASE_EN_DIR"
    echo "To re-download, delete the directory first: rm -rf $BASE_EN_DIR"
    exit 0
fi

echo "Downloading faster-whisper base.en model (CTranslate2 format)..."
echo "Source: https://huggingface.co/$HF_REPO"
echo "Destination: $BASE_EN_DIR"

for f in "${FILES[@]}"; do
    url="https://huggingface.co/$HF_REPO/resolve/$BRANCH/$f"
    dest="$BASE_EN_DIR/$f"
    if [ -f "$dest" ]; then
        echo "  [skip] $f (already exists)"
        continue
    fi
    echo "  [downloading] $f ..."
    curl -L --progress-bar -o "$dest" "$url"
done

echo ""
echo "Download complete! Model files:"
ls -lh "$BASE_EN_DIR/"