import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { version as pkgVersion } from './package.json'
import { compareGolden } from './src/test/golden/commands'

// Golden-image tests: render in real Chromium and compare against committed
// PNGs. Separate from the unit suite (happy-dom can't rasterise anything) and
// kept out of `bun run test`; run with `bun run test:golden`. docs/TESTING.md
// covers re-recording.
export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    plugins: [react()],
    test: {
        include: ['src/**/*.golden.test.{ts,tsx}'],
        setupFiles: ['./src/test/golden/setup.ts'],
        browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            // Larger than any golden, so an element screenshot is never clipped.
            viewport: { width: 1280, height: 720 },
            instances: [
                {
                    browser: 'chromium',
                    launch: {
                        // Software rasterisation and a fixed colour profile, so
                        // a golden doesn't depend on the machine's GPU or display.
                        args: ['--disable-gpu', '--force-color-profile=srgb', '--font-render-hinting=none'],
                    },
                },
            ],
            commands: { compareGolden },
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
})
