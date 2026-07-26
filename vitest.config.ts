import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { version as pkgVersion } from './package.json'

export default defineConfig({
    // Mirror the `__APP_VERSION__` define from vite.config.ts so tests that
    // import App-level code don't hit an undefined global.
    define: {
        __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    plugins: [react()],
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['./src/test-setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        pool: 'forks',
        poolOptions: {
            forks: {
                execArgv: ['--max-old-space-size=4096'],
            },
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*.ts', 'src/**/*.tsx'],
            exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__tests__/**'],
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
})
