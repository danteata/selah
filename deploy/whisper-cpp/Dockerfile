# Use a lightweight Ubuntu image as the base
FROM ubuntu:22.04 AS builder

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

# Build the server using cmake with static linking
RUN mkdir build && cd build && \
    cmake .. -DWHISPER_SERVER=ON -DBUILD_SHARED_LIBS=OFF && \
    cmake --build . --config Release -j$(nproc)

# Download the model (base.en is a good balance for sermons)
RUN ./models/download-ggml-model.sh base.en

# Final image
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/build/bin/whisper-server /app/server
COPY --from=builder /app/models/ggml-base.en.bin /app/models/ggml-base.en.bin

# Expose the server port
EXPOSE 8080

# Start the server
CMD ["./server", "-m", "models/ggml-base.en.bin", "--host", "0.0.0.0", "--port", "8080"]
