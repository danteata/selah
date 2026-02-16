#!/bin/bash
# Script to install and run whisper.cpp server locally
# Run from the selah project root: ./scripts/start-whisper-cpp.sh

set -e

WHISPER_DIR="$HOME/whisper.cpp"
MODEL="base.en"
PORT=8080

# Check if whisper.cpp already exists
if [ ! -d "$WHISPER_DIR" ]; then
    echo "📥 Cloning whisper.cpp..."
    git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
fi

cd "$WHISPER_DIR"

# Check if server binary exists
if [ ! -f "server" ]; then
    echo "🔨 Building whisper.cpp server..."
    make server
fi

# Check if model exists
if [ ! -f "models/ggml-$MODEL.bin" ]; then
    echo "📦 Downloading $MODEL model..."
    ./models/download-ggml-model.sh "$MODEL"
fi

echo "🚀 Starting whisper.cpp server on port $PORT..."
echo "   Endpoint: http://127.0.0.1:$PORT/inference"
echo "   Press Ctrl+C to stop"
echo ""

./server -m "models/ggml-$MODEL.bin" --host 0.0.0.0 --port "$PORT"
