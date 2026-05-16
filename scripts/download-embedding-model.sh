#!/usr/bin/env bash
# Downloads the MiniLM embedding model (Xenova/all-MiniLM-L6-v2) into
# `src-tauri/assets/embedding-models/Xenova/all-MiniLM-L6-v2/` so the desktop
# bundle ships the weights instead of fetching them from the HuggingFace Hub
# on first launch.
#
# Why: Transformers.js on web pulls ~22 MB of ONNX weights the first time the
# semantic detector runs. On desktop we'd rather pay that cost once at install
# time and have the search engine work offline forever after.
#
# Re-run this script before `tauri build` (the desktop:prebuild step in
# package.json can call it). The files are committed to the repo so CI builds
# don't need network access.

set -euo pipefail

REPO="Xenova/all-MiniLM-L6-v2"
BASE_URL="https://huggingface.co/${REPO}/resolve/main"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${SCRIPT_DIR}/../src-tauri/assets/embedding-models/${REPO}"

mkdir -p "${DEST_DIR}/onnx"

# Files required by @xenova/transformers feature-extraction pipeline.
FILES=(
    "config.json"
    "tokenizer.json"
    "tokenizer_config.json"
    "onnx/model_quantized.onnx"
)

for file in "${FILES[@]}"; do
    out="${DEST_DIR}/${file}"
    if [[ -f "${out}" && -s "${out}" ]]; then
        echo "[skip] ${file} already present ($(du -h "${out}" | cut -f1))"
        continue
    fi
    echo "[fetch] ${file}"
    mkdir -p "$(dirname "${out}")"
    curl -fL --retry 3 --retry-delay 2 -o "${out}" "${BASE_URL}/${file}"
done

echo ""
echo "Embedding model ready at:"
echo "  ${DEST_DIR}"
echo ""
echo "Total size:"
du -sh "${DEST_DIR}"
