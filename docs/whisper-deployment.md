# Deploying Whisper Transcription Services

This guide covers deploying both Faster-Whisper (recommended) and Whisper.cpp to Fly.io for production use.

## Faster-Whisper Deployment (Recommended)

Faster-Whisper uses CTranslate2 for 2-4x faster transcription and supports webm audio format directly.

### Option 1: Using Speaches (Recommended)

[Speaches](https://github.com/speaches/speaches) provides a ready-to-use faster-whisper server with OpenAI-compatible API.

#### 1. Create Deployment Directory

```bash
mkdir -p deploy/faster-whisper
cd deploy/faster-whisper
```

#### 2. Create Dockerfile

```dockerfile
FROM python:3.11-slim

# Install dependencies
RUN pip install --no-cache-dir speaches

# Download model during build (optional - speeds up cold start)
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('Systran/faster-whisper-base.en', device='cpu', compute_type='int8')"

# Expose port
EXPOSE 8000

# Start server
CMD ["speaches", "--model", "Systran/faster-whisper-base.en", "--host", "0.0.0.0", "--port", "8000"]
```

#### 3. Create fly.toml

```toml
app = "selah-faster-whisper"
primary_region = "cdg"

[build]

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024
```

#### 4. Deploy

```bash
fly launch --name selah-faster-whisper --no-deploy
fly deploy
```

#### 5. Configure Selah

Set the environment variable:
```bash
VITE_FASTER_WHISPER_ENDPOINT=https://selah-faster-whisper.fly.dev
```

### Option 2: Using Docker Compose (Development)

For local development with hot-reload:

```yaml
# docker-compose.yml
version: '3.8'
services:
  faster-whisper:
    image: ghcr.io/speaches/speaches:latest
    ports:
      - "8000:8000"
    environment:
      - MODEL=Systran/faster-whisper-base.en
    command: ["--model", "Systran/faster-whisper-base.en", "--host", "0.0.0.0", "--port", "8000"]
```

Run with:
```bash
docker-compose up -d
```

## Whisper.cpp Deployment (Alternative)

For offline/local transcription using the original whisper.cpp implementation.

### 1. Create Deployment Directory

```bash
mkdir -p deploy/whisper-cpp
cd deploy/whisper-cpp
```

### 2. Create Dockerfile

```dockerfile
# Use a lightweight Ubuntu image as the base
FROM ubuntu:22.04 as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    cmake \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Clone and build whisper.cpp
WORKDIR /app
RUN git clone https://github.com/ggerganov/whisper.cpp.git .
RUN make server

# Download the model (base.en is a good balance for sermons)
RUN ./models/download-ggml-model.sh base.en

# Final image
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/server /app/server
COPY --from=builder /app/models/ggml-base.en.bin /app/models/ggml-base.en.bin

# Expose the server port
EXPOSE 8080

# Start the server
CMD ["./server", "-m", "models/ggml-base.en.bin", "--host", "0.0.0.0", "--port", "8080"]
```

### 3. Create fly.toml

```toml
app = "selah-whisper"
primary_region = "cdg"

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024
```

### 4. Deploy

```bash
fly launch --name selah-whisper --no-deploy
fly deploy
```

### 5. Configure Selah

Set the environment variable:
```bash
VITE_WHISPER_CPP_ENDPOINT=https://selah-whisper.fly.dev/inference
```

## Model Selection Guide

| Model | Size | Speed | Accuracy | Recommended For |
|-------|------|-------|----------|-----------------|
| tiny.en | ~75MB | Fastest | Good | Testing, low-resource |
| base.en | ~142MB | Fast | Better | Sermons (recommended) |
| small.en | ~466MB | Medium | Great | High accuracy needs |
| medium.en | ~1.5GB | Slow | Excellent | Critical accuracy |
| distil-large-v3 | ~1.5GB | Fast | Excellent | Best quality/speed |

For sermon transcription, `base.en` provides the best balance of speed and accuracy.

## Local Development Setup

### Faster-Whisper (Recommended)

```bash
# Using pip
pip install speaches
speaches --model Systran/faster-whisper-base.en --host 127.0.0.1 --port 8000

# Using Docker
docker run -p 8000:8000 ghcr.io/speaches/speaches:latest \
  --model Systran/faster-whisper-base.en
```

### Whisper.cpp

```bash
# Clone and build
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
make

# Download model
./models/download-ggml-model.sh base.en

# Start server
./build/bin/whisper-server -m ./models/ggml-base.en.bin --host 127.0.0.1 --port 8080
```

## Vite Proxy Configuration

For local development, configure the Vite proxy to avoid CORS issues:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/faster-whisper': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/faster-whisper/, ''),
      },
      '/whisper-cpp': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/whisper-cpp/, ''),
      },
    },
  },
})
```

## Security Considerations

### Authentication

Both servers are unauthenticated by default. For production:

1. **API Key**: Add authentication middleware
2. **CORS**: Configure allowed origins
3. **Rate Limiting**: Prevent abuse

### Example: Nginx Reverse Proxy with Auth

```nginx
server {
    listen 443 ssl;
    server_name whisper.yourdomain.com;

    location / {
        # Check for API key
        if ($http_x_api_key != "your-secret-key") {
            return 403;
        }

        # CORS headers
        add_header 'Access-Control-Allow-Origin' 'https://your-selah-app.com' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, X-API-Key' always;

        proxy_pass http://localhost:8000;
    }
}
```

## Cost Optimization

### Fly.io Settings

```toml
# fly.toml
[http_service]
  auto_stop_machines = true    # Stop when not in use
  auto_start_machines = true   # Start on first request
  min_machines_running = 0     # No always-on machines
```

This configuration:
- Stops machines after inactivity (saves money)
- Automatically starts on first request (cold start ~5-10s)
- Costs only for actual usage

### Memory Optimization

For smaller memory footprint:
```toml
[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512  # Minimum for tiny.en model
```

## Monitoring

### Health Check Endpoint

Faster-Whisper (speaches):
```bash
curl https://your-server.fly.dev/health
# Returns: OK
```

Whisper.cpp:
```bash
curl https://your-server.fly.dev/health
# Returns: OK
```

### Logs

```bash
fly logs -a selah-faster-whisper
```

## Troubleshooting

### Cold Start Issues

If cold starts are too slow:
1. Increase `min_machines_running` to 1
2. Use a smaller model (tiny.en)
3. Pre-warm the server before events

### Memory Errors

If you see OOM errors:
1. Increase `memory_mb` in fly.toml
2. Use a smaller model
3. Reduce concurrent requests

### Connection Timeouts

1. Check server health endpoint
2. Verify CORS configuration
3. Check Fly.io logs for errors
