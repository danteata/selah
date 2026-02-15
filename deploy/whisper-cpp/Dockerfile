FROM ubuntu:22.04 as builder
RUN apt-get update && apt-get install -y build-essential git cmake wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN git clone https://github.com/ggerganov/whisper.cpp.git .
RUN make server
RUN ./models/download-ggml-model.sh base.en

FROM ubuntu:22.04
RUN apt-get update && apt-get install -y libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/server /app/server
COPY --from=builder /app/models/ggml-base.en.bin /app/models/ggml-base.en.bin
EXPOSE 8080
CMD ["./server", "-m", "models/ggml-base.en.bin", "--host", "0.0.0.0", "--port", "8080"]
