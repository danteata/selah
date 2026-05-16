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
  esbuild: {
    // Strip console.log + debugger statements from production builds. Keep
    // console.warn and console.error so genuine problems still surface in the
    // wild. This removes ~140 chatty log calls from the sermon listener's
    // hot path alone.
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production' ? ['console.log', 'console.debug', 'console.info'] : [],
  },
  build: {
    // Ensure WASM files are handled correctly
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    // Split heavy vendor libraries into their own chunks so a Selah patch
    // release doesn't re-download Convex/Clerk/Tiptap. Each chunk is cached
    // independently by the browser/Tauri webview.
    rollupOptions: {
      output: {
        manualChunks: {
          'react': ['react', 'react-dom', 'react-router-dom'],
          'convex': ['convex/react', 'convex/browser'],
          'clerk': ['@clerk/clerk-react'],
          'tiptap': ['@tiptap/react', '@tiptap/starter-kit'],
          'icons': ['lucide-react'],
          'query': ['@tanstack/react-query'],
        },
      },
    },
    // Slightly bigger chunk-size warning ceiling; we already split the big libs.
    chunkSizeWarningLimit: 800,
  },
  // Configure WASM file serving
  assetsInclude: ['**/*.wasm'],
})
