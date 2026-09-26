import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { version as pkgVersion } from './package.json'

// https://vite.dev/config/
export default defineConfig({
  // Bake the package version in at build time so both web and desktop have a
  // synchronous version string (the Tauri `getVersion()` API is async and
  // desktop-only). package.json and tauri.conf.json versions are kept in sync.
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
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
        // A function, not the object form: that can't place the CommonJS
        // wrappers Rollup generates, so `react/jsx-runtime`'s ended up in the
        // tiptap chunk — the first to reach it — and every page, landing and
        // login included, had to preload the whole editor just to render JSX.
        manualChunks(id) {
          // Rollup's shared CommonJS helpers live outside node_modules; left
          // alone they land in whichever chunk uses them first (clerk) and
          // make react import from it — a circular chunk. Everything loads
          // react first, so they go there.
          if (id.includes('commonjsHelpers')) return 'react'
          if (!id.includes('node_modules')) return undefined
          const pkg = (name: string) => new RegExp(`[\\\\/]node_modules[\\\\/]${name}[\\\\/]`).test(id)
          if (pkg('react') || pkg('react-dom') || pkg('scheduler') || pkg('react-router') || pkg('react-router-dom')) return 'react'
          if (pkg('convex')) return 'convex'
          if (pkg('@clerk')) return 'clerk'
          if (pkg('@tiptap') || /[\\/]node_modules[\\/]prosemirror-/.test(id)) return 'tiptap'
          if (pkg('lucide-react')) return 'icons'
          if (pkg('three')) return 'three'
          // The studio's own vendors, split out of the Dashboard chunk so an
          // app update doesn't make every operator re-download them.
          if (pkg('framer-motion') || pkg('motion-dom') || pkg('motion-utils')) return 'motion'
          if (pkg('react-grid-layout') || pkg('react-draggable') || pkg('react-resizable')) return 'grid-layout'
          return undefined
        },
      },
    },
    // Slightly bigger chunk-size warning ceiling; we already split the big libs.
    chunkSizeWarningLimit: 800,
  },
  // Configure WASM file serving
  assetsInclude: ['**/*.wasm'],
})
