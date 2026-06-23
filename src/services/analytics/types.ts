/**
 * Provider-agnostic analytics types.
 * Any new provider just needs to implement {@link AnalyticsProvider}.
 */

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface AnalyticsEvent {
    name: string
    properties?: Record<string, unknown>
    timestamp?: Date
}

export interface AnalyticsUserProperties {
    [key: string]: unknown
}

export interface AnalyticsProvider {
    /** One-time initialisation (SDK init, etc.). */
    init(config: AnalyticsProviderConfig): Promise<void> | void
    /** Capture an event. */
    track(event: AnalyticsEvent): void | Promise<void>
    /** Associate the following events with a user. */
    identify(userId: string, properties?: AnalyticsUserProperties): void | Promise<void>
    /** Set super-properties / user properties that attach to every event. */
    setUserProperties(properties: AnalyticsUserProperties): void | Promise<void>
    /** Reset the current user (e.g. on logout). */
    reset(): void | Promise<void>
    /** Track a page / screen view. */
    page(name: string, properties?: Record<string, unknown>): void | Promise<void>
    /** Flush buffered events. */
    flush?(): Promise<void>
    /** Enable or disable collection at runtime. */
    setEnabled(enabled: boolean): void | Promise<void>
    /** Opt-out of tracking (GDPR). */
    optOut?(): void
    /** Opt-in to tracking. */
    optIn?(): void
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const AnalyticsProviderType = {
    POSTHOG: 'posthog',
    AMPLITUDE: 'amplitude',
    CONSOLE: 'console',
    NONE: 'none',
} as const

export type AnalyticsProviderType = (typeof AnalyticsProviderType)[keyof typeof AnalyticsProviderType]

export interface AnalyticsProviderConfig {
    apiKey: string
    /** Extra options forwarded to the underlying SDK. */
    options?: Record<string, unknown>
    /** Whether analytics is enabled (defaults to true). */
    enabled?: boolean
    /** Current environment — used for provider-specific tweaks. */
    environment?: 'development' | 'production' | 'staging'
    /** Application version attached to every event. */
    appVersion?: string
    /** Whether the app is running on desktop (Tauri). */
    isDesktop?: boolean
}

// ---------------------------------------------------------------------------
// Selah-specific event names (type-safe enum)
// ---------------------------------------------------------------------------

export const AnalyticsEventType = {
    // App lifecycle
    APP_INITIALIZED: 'app_initialized',
    APP_LOADED: 'app_loaded',
    SESSION_START: 'session_start',

    // Auth
    USER_SIGNED_IN: 'user_signed_in',
    USER_SIGNED_UP: 'user_signed_up',
    USER_SIGNED_OUT: 'user_signed_out',
    AUTH_ATTEMPTED: 'auth_attempted',
    AUTH_FAILED: 'auth_failed',
    AUTH_GOOGLE_CLICKED: 'auth_google_clicked',
    SIGNUP_STEP_COMPLETED: 'signup_step_completed',
    EMAIL_VERIFICATION_SENT: 'email_verification_sent',
    EMAIL_VERIFICATION_ATTEMPTED: 'email_verification_attempted',

    // Navigation
    PAGE_VIEWED: 'page_viewed',
    LANDING_CTA_CLICKED: 'landing_cta_clicked',
    LANDING_SECTION_VIEWED: 'landing_section_viewed',

    // Slides / Live
    SLIDE_CREATED: 'slide_created',
    SLIDE_EDITED: 'slide_edited',
    SLIDE_DELETED: 'slide_deleted',
    SLIDE_DISPLAYED: 'slide_displayed',
    SLIDE_REORDERED: 'slide_reordered',
    SLIDE_TEMPLATE_USED: 'slide_template_used',
    LIVE_SESSION_STARTED: 'live_session_started',
    LIVE_SESSION_ENDED: 'live_session_ended',
    LIVE_COLLABORATION_JOINED: 'live_collaboration_joined',
    MULTI_MONITOR_OPENED: 'multi_monitor_opened',

    // Bible
    BIBLE_VERSION_SELECTED: 'bible_version_selected',
    BIBLE_SEARCH_PERFORMED: 'bible_search_performed',
    BIBLE_VERSE_SELECTED: 'bible_verse_selected',
    BIBLE_EMBEDDING_SYNC_STARTED: 'bible_embedding_sync_started',
    BIBLE_EMBEDDING_SYNC_COMPLETED: 'bible_embedding_sync_completed',
    BIBLE_SEMANTIC_SEARCH: 'bible_semantic_search',

    // Songs / Hymns
    SONG_SELECTED: 'song_selected',
    SONG_SEARCHED: 'song_searched',
    HYMN_VIEWED: 'hymn_viewed',

    // Media
    MEDIA_UPLOADED: 'media_uploaded',
    MEDIA_SELECTED: 'media_selected',
    MEDIA_REMOVED: 'media_removed',
    BACKGROUND_CHANGED: 'background_changed',

    // Schedules
    SCHEDULE_CREATED: 'schedule_created',
    SCHEDULE_EDITED: 'schedule_edited',
    SCHEDULE_VIEWED: 'schedule_viewed',

    // Sermon Listener
    SERMON_LISTENER_STARTED: 'sermon_listener_started',
    SERMON_LISTENER_STOPPED: 'sermon_listener_stopped',
    SERMON_LISTENER_TRANSCRIPTION: 'sermon_listener_transcription',
    SERMON_LISTENER_VERSE_DETECTED: 'sermon_listener_verse_detected',
    SERMON_LISTENER_ERROR: 'sermon_listener_error',

    // Countdown
    COUNTDOWN_STARTED: 'countdown_started',
    COUNTDOWN_COMPLETED: 'countdown_completed',

    // Alerts / Lower Thirds
    ALERT_TRIGGERED: 'alert_triggered',
    LOWER_THIRD_DISPLAYED: 'lower_third_displayed',

    // Settings
    SETTING_CHANGED: 'setting_changed',
    SETTINGS_OPENED: 'settings_opened',
    SETTINGS_TAB_CHANGED: 'settings_tab_changed',
    THEME_CHANGED: 'theme_changed',
    BIBLE_VERSION_CHANGED: 'bible_version_changed',

    // Team
    TEAM_INVITATION_SENT: 'team_invitation_sent',
    TEAM_MEMBER_JOINED: 'team_member_joined',
    CHURCH_CREATED: 'church_created',
    CHURCH_JOINED: 'church_joined',
    INVITATION_ACCEPTED: 'invitation_accepted',

    // Downloads
    DOWNLOAD_INITIATED: 'download_initiated',
    DOWNLOAD_COMPLETED: 'download_completed',

    // Desktop
    DESKTOP_UPDATE_CHECKED: 'desktop_update_checked',
    DESKTOP_UPDATE_INSTALLED: 'desktop_update_installed',

    // Performance / Errors
    ERROR_OCCURRED: 'error_occurred',
    PERFORMANCE_TIMING: 'performance_timing',

    // Feature usage
    QUICK_ACTION_USED: 'quick_action_used',
    LIBRARY_ACCESSED: 'library_accesed',
    OFFLINE_MODE_ENTERED: 'offline_mode_entered',
} as const

export type AnalyticsEventType = (typeof AnalyticsEventType)[keyof typeof AnalyticsEventType]

// ---------------------------------------------------------------------------
// Privacy helpers — sanitize errors and sensitive data before tracking
// ---------------------------------------------------------------------------

/**
 * Map raw Clerk / backend error messages to safe, non-PII categories.
 * Never pass raw error messages to analytics — they may contain emails,
 * tokens, or other sensitive data.
 */
export function sanitizeAuthError(rawMessage: string): string {
    const msg = rawMessage.toLowerCase()
    if (msg.includes('password')) return 'invalid_credentials'
    if (msg.includes('email') && msg.includes('exist')) return 'email_exists'
    if (msg.includes('email') && msg.includes('format')) return 'invalid_email'
    if (msg.includes('verification') || msg.includes('code')) return 'verification_failed'
    if (msg.includes('rate') || msg.includes('limit')) return 'rate_limited'
    if (msg.includes('network') || msg.includes('connection')) return 'network_error'
    if (msg.includes('session') || msg.includes('expired')) return 'session_expired'
    if (msg.includes('permission') || msg.includes('unauthorized')) return 'permission_denied'
    if (msg.includes('invitation') || msg.includes('invite')) return 'invitation_error'
    if (msg.includes('church')) return 'church_setup_error'
    return 'unknown_error'
}
