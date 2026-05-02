#!/bin/bash
# Download and prepare a faster-whisper CTranslate2 model for bundling with the app.
#
# Usage:
#   ./download-model.sh                    # Downloads base.en (default)
#   ./download-model.sh small.en           # Downloads a different model
#
# The model files are placed in src-tauri/assets/whisper-models/<model>/
# and will be bundled as Tauri resources when you build the app.

set -e

MODEL_ID="${1:-base.en}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS_DIR="${SCRIPT_DIR}/../assets/whisper-models"
OUTPUT_DIR="${ASSETS_DIR}/${MODEL_ID}"

echo "Downloading faster-whisper model: ${MODEL_ID}"
echo "Output directory: ${OUTPUT_DIR}"

MODEL_MAP='{
  "tiny": "Systran/faster-whisper-tiny",
  "tiny.en": "Systran/faster-whisper-tiny.en",
  "base": "Systran/faster-whisper-base",
  "base.en": "Systran/faster-whisper-base.en",
  "small": "Systran/faster-whisper-small",
  "small.en": "Systran/faster-whisper-small.en",
  "medium": "Systran/faster-whisper-medium",
  "medium.en": "Systran/faster-whisper-medium.en",
  "large-v3": "Systran/faster-whisper-large-v3",
  "distil-large-v3": "Systran/faster-distil-whisper-large-v3"
}'

HF_REPO_ID=$(echo "$MODEL_MAP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('$MODEL_ID', '$MODEL_ID'))")

echo "HuggingFace repo: ${HF_REPO_ID}"

mkdir -p "${OUTPUT_DIR}"

VENV_DIR="${SCRIPT_DIR}/.venv-download"
if [ ! -d "${VENV_DIR}" ]; then
    echo "Creating temporary virtual environment..."
    python3 -m venv "${VENV_DIR}"
    source "${VENV_DIR}/bin/activate"
    pip install --upgrade pip
    pip install faster-whisper
else
    source "${VENV_DIR}/bin/activate"
fi

python3 -c "
from faster_whisper import WhisperModel
import shutil, os

model_id = '${HF_REPO_ID}'
output_dir = '${OUTPUT_DIR}'

print(f'Downloading model: {model_id}...')
print('This may take a few minutes on first run...')

model = WhisperModel(model_id, device='cpu', compute_type='int8')

cache_dir = os.path.expanduser('~/.cache/huggingface/hub')
model_cache = None
for root, dirs, files in os.walk(cache_dir):
    if 'model.bin' in files or 'model.ct2' in files:
        parent = os.path.dirname(root)
        if model_id.replace('/', '--') in parent:
            model_cache = root
            break

if model_cache:
    print(f'Copying model files from cache: {model_cache}')
    os.makedirs(output_dir, exist_ok=True)
    for f in os.listdir(model_cache):
        src = os.path.join(model_cache, f)
        dst = os.path.join(output_dir, f)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f'  Copied: {f} ({os.path.getsize(dst)} bytes)')
    print('Model files copied successfully.')
else:
    print('Warning: Could not locate cached model files automatically.')
    print('The model is cached by HuggingFace but the file locations vary.')
    print('Trying alternative approach...')

    from huggingface_hub import snapshot_download
    snapshot_dir = snapshot_download(repo_id=model_id, allow_patterns=['*.bin', '*.json', '*.txt', '*.onnx'])
    print(f'Downloaded to: {snapshot_dir}')
    os.makedirs(output_dir, exist_ok=True)
    for f in os.listdir(snapshot_dir):
        src = os.path.join(snapshot_dir, f)
        dst = os.path.join(output_dir, f)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f'  Copied: {f} ({os.path.getsize(dst)} bytes)')
    print('Model files copied successfully.')
"

echo ""
echo "Done! Model '${MODEL_ID}' is ready at:"
echo "  ${OUTPUT_DIR}"
echo ""
echo "Total size:"
du -sh "${OUTPUT_DIR}"
echo ""
echo "The model will be bundled with the app when you run 'tauri build'."