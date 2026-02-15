# Deploying Whisper.cpp to Fly.io

Since Selah's `whisper-cpp` provider works by sending audio chunks to an HTTP endpoint, you need a hosted version of the `whisper.cpp` server to use this feature in production.

This guide explains how to deploy `whisper.cpp` as a separate app on Fly.io.

## 1. Setup Deployment Directory

Create a new directory for the whisper server (outside your main Selah project, or in a `deploy/whisper-cpp` subfolder):

```bash
mkdir -p deploy/whisper-cpp
cd deploy/whisper-cpp
```

## 2. Dockerfile

Create a `Dockerfile` in that directory:

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

## 3. Fly.io Configuration

Create a `fly.toml` in the same directory:

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

> [!NOTE]
> `min_machines_running = 0` and `auto_stop_machines = true` will save you money by stopping the server when not in use. It will take a few seconds to start up (cold start) when you first start transcribing.

## 4. Deploy

Run the following commands:

```bash
fly launch --name selah-whisper --no-deploy
fly deploy
```

## 5. Configure Selah

Once deployed, your endpoint will be:
`https://selah-whisper.fly.dev/inference`

1.  Go to your Selah production app's environment variables.
2.  Set `VITE_WHISPER_CPP_ENDPOINT=https://selah-whisper.fly.dev/inference`.
3.  Redeploy Selah.

## Security Considerations

The `whisper.cpp` server is unauthenticated by default. To restrict access:
1.  **CORS**: The server might need CORS headers if called directly from the browser. You can modify the `CMD` in the Dockerfile if the server supports it, or use a reverse proxy.
2.  **Origin Restriction**: For more security, you could put a small proxy (like Nginx or a simple Bun/Node script) in front of the whisper server to check for an API key or a specific `Origin` header.
