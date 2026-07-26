/// <reference types="vite/client" />

// Injected by Vite's `define` (see vite.config.ts) — the package.json version.
declare const __APP_VERSION__: string

interface ImportMetaEnv {
    readonly VITE_CONVEX_URL: string
    readonly VITE_CLERK_PUBLISHABLE_KEY: string
    readonly VITE_FF_SERMON_LISTENER?: string

    // Analytics
    readonly VITE_ANALYTICS_PROVIDER?: 'posthog' | 'amplitude' | 'console' | 'none'
    readonly VITE_POSTHOG_KEY?: string
    readonly VITE_AMPLITUDE_KEY?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}