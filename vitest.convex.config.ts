import { defineConfig } from 'vitest/config'

// The backend's tests: Convex functions run against convex-test's in-memory
// backend, which needs the edge runtime rather than the app's happy-dom.
export default defineConfig({
    test: {
        environment: 'edge-runtime',
        include: ['convex/**/*.test.ts'],
        server: { deps: { inline: ['convex-test'] } },
    },
})
