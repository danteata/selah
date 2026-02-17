#!/bin/bash
# Script to install and run whisper.cpp server locally (Docker recommended)
# Run from the selah project root: ./scripts/start-whisper-cpp.sh

set -e

PORT=8080
IMAGE_NAME="selah-whisper"
DOCKER_DIR="deploy/whisper-cpp"

# Check if Docker is installed and daemon is running
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "🐳 Docker detected and running. Using Docker for whisper.cpp setup..."
    
    cd "$DOCKER_DIR"
    
    echo "🔨 Building Docker image $IMAGE_NAME..."
    docker build -t "$IMAGE_NAME" .
    
    echo "🛑 Stopping existing container if running..."
    docker stop "$IMAGE_NAME" 2>/dev/null || true
    docker rm "$IMAGE_NAME" 2>/dev/null || true
    
    echo "🚀 Starting whisper.cpp server in Docker on port $PORT..."
    docker run -d --name "$IMAGE_NAME" -p "$PORT:8080" "$IMAGE_NAME"
    
    echo "✅ Server started. Endpoint: http://127.0.0.1:$PORT/inference"
    echo "   Use 'docker logs -f $IMAGE_NAME' to see output"
    exit 0
fi

echo "⚠️ Docker not found. Falling back to manual build..."
WHISPER_DIR="$HOME/whisper.cpp"
MODEL="small.en"

# Check if whisper.cpp already exists
if [ ! -d "$WHISPER_DIR" ]; then
    echo "📥 Cloning whisper.cpp..."
    git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
fi

cd "$WHISPER_DIR"

# Build using cmake (more reliable for the server)
if [ ! -f "build/bin/whisper-server" ] && [ ! -f "server" ]; then
    echo "🔨 Building whisper.cpp server..."
    mkdir -p build && cd build
    cmake .. -DWHISPER_SERVER=ON
    cmake --build . --config Release -j
    cd ..
fi

# Determine server binary path
if [ -f "build/bin/whisper-server" ]; then
    SERVER_BIN="./build/bin/whisper-server"
elif [ -f "server" ]; then
    SERVER_BIN="./server"
else
    echo "❌ Failed to build whisper-server binary."
    exit 1
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

$SERVER_BIN -m "models/ggml-$MODEL.bin" --host 0.0.0.0 --port "$PORT"
