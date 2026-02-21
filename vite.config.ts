import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    strictPort: true,
    port: 3000,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3000,
    },
    proxy: {
      // Proxy faster-whisper/speaches requests to avoid CORS
      '/faster-whisper': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/faster-whisper/, ''),
      },
      // Proxy whisper.cpp requests to avoid CORS
      '/whisper-cpp': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/whisper-cpp/, ''),
      },
    },
  },
  envPrefix: ['VITE_'],
  optimizeDeps: {
    // Exclude onnxruntime-web from optimization to avoid dynamic import issues
    // Note: @xenova/transformers is loaded from CDN, not bundled
    exclude: ['onnxruntime-web'],
  },
  build: {
    // Ensure WASM files are handled correctly
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  // Configure WASM file serving
  assetsInclude: ['**/*.wasm'],
})
