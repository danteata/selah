import type { Emitter, EventType } from 'mitt'

// ==================== App Events Type ====================

export type AppEvents = {
    'live-transfer': Slide
    'new-text': Slide | undefined | [Slide]
    'new-bible': Slide | undefined | [Slide]
    'new-hymn': Slide | undefined | [Slide]
    'new-song': Slide | undefined | [Slide]
    'new-slide': undefined
    'new-media': Slide | undefined | [Slide]
    'new-youtube-video': Slide | undefined | [Slide]
    'new-vimeo-video': Slide | undefined | [Slide]
    'new-library': Slide | undefined | [Slide]
    'new-templates': Slide | undefined | [Slide]
    'new-alert': Slide | undefined | [Slide]
    'add-song': Slide | undefined | [Slide]
    'remove-alert': undefined
    'new-countdown': Slide | undefined | [Slide]
    'new-lower-third': Slide | undefined | [Slide]
    'new-search-bible': Slide | undefined | [Slide]
    'go-live': undefined
    'close-live-window': undefined
    'open-settings': undefined
    'new-active-slide': Slide
    'delete-slide': Slide
    'select-slides': undefined
    'show-changelog': undefined
    'refresh-slides': undefined
    'start-countdown': undefined
    'restart-countdown': undefined
    'stop-countdown': undefined
    'media-seek': number
    'app-loading': boolean
    'goto-verse': number
    'delete-schedule-slides': undefined
    'selected-schedule': Schedule
    'open-schedule-modal': undefined
    'toggle-dark-mode': undefined
    'join-community': undefined
    'open-invite-modal': undefined
    'live-slide-id-transfer': string
    'live-active-slides-transfer': Slide[]
    'live-settings-transfer': AppSettings
    'quick-actions-focus': undefined
    'upload-offline-slides': undefined
    'batch-update-slides': undefined
    'open-shortcuts': undefined
    'promote-active-slide-live': undefined
}

// ==================== Core Types ====================

export interface User {
    _id: string
    fullname: string
    email: string
    role: string
    avatar: string
    theme: string
    createdAt: string
    updatedAt: string
    churchId: string
    emailVerified?: boolean
    subscription?: {
        plan: 'free' | 'teams'
        startDate: string
        endDate: string | null
    }
}

export interface Church {
    _id: string
    name: string
    type: string
    address: string
    pastor: string
    userIds?: string[]
    users: User[]
    storageUsed?: number
    subscriptionPlan: 'free' | 'teams'
}

export interface Slide {
    _id?: string
    id: string
    index: number
    name: string
    type: string
    layout: string
    userId: string
    churchId: string
    scheduleId: string
    contents: string[]
    backgroundType?: string
    background?: string
    backgroundVideoKey?: string | null
    backgroundStorageId?: string | null
    title?: string
    songId?: string
    hasChorus?: boolean
    data?: Song | Scripture | Hymn | Countdown | ExtendedFileT
    slideStyle?: SlideStyle
    saved?: boolean
    createdAt?: string
    updatedAt?: string
    // Verse tracking for songs/hymns
    verseIndex?: number
    totalVerses?: number
    verseLabel?: string
}

export interface Template {
    _id: string
    name: string
    description?: string
    slideId: string | Slide
    createdBy: string
    category: 'announcement' | 'worship' | 'sermon' | 'prayer' | 'general'
    thumbnail?: string
    createdAt: string
    updatedAt: string
}

export interface Schedule {
    _id: string
    name: string
    authorId: string
    editorIds: User[]
    churchId: string
    lastUpdated?: string
    createdAt?: string
    updatedAt?: string
}

export interface Alert {
    _id?: string
    id: string
    title?: string
    icon?: string
    style?: string
    background?: string
    content: string
    duration: number
    priority: 'low' | 'medium' | 'high'
    createdAt?: string
}

export interface Countdown {
    _id?: string
    id: string
    time: string
    timeLeft: string
    content: string
}

export interface QuickAction {
    icon: string
    name: string
    desc: string
    action: string
    type?: string
    unreleased?: boolean
    bibleBookIndex?: string
    bibleChapterAndVerse?: string
    hymnIndex?: string
    searchableOnly?: boolean
    meta?: string
    tier?: 'free' | 'teams'
}

export interface Scripture {
    label: string
    labelShortFormat: string
    version: string
    content: string | BibleVerse[]
}

export interface BibleVerse {
    book: string
    chapter: string
    verse: string
    scripture: string
}

export interface BibleVersion {
    id: string
    name: string
    isDownloaded: boolean
    copyrightContent: string
    isPublicDomain?: boolean
}

export interface Hymn {
    number: string
    title: string
    chorus: string
    verses: string[]
    author: string
    source: string
    meta: string
}

export interface Song {
    _id?: string
    id: string
    lyrics: string
    title: string
    artist: string
    album?: string
    cover?: string
    author?: string
    verses?: string[]
    isPublic?: boolean
    createdBy?: string
    churchId?: string
    createdAt?: string
    updatedAt?: string
}

export interface ExternalVideo {
    url: string
    type: string
    name?: string
    thumbnail?: string
}

export interface Media {
    id: string
    content?: unknown
    remoteUrl?: string
    data?: ArrayBuffer | File | string | ExternalVideo
    createdAt?: string
    updatedAt?: string
}

export interface BackgroundVideo {
    id: string
    url: string
}

export interface LibraryItem {
    id: string
    type: string
    content: Slide | Song
    createdAt?: string
    updatedAt?: string
}

export interface SlideStyle {
    blur?: number
    brightness?: number
    alignment?: string
    font?: string
    linesPerSlide?: number
    fontSize?: number
    fontSizePercent?: number
    backgroundFillType?: string
    repeatMedia?: boolean
    isMediaPlaying?: boolean
    mediaSeekPosition?: number
    isMediaMuted?: boolean
    windowPadding?: {
        left?: number
        right?: number
        top?: number
        bottom?: number
    }
    lettercase?: string
    lineSpacing?: string
    textOutlined?: boolean
    bibleVersion?: string
    // Lower Third settings
    lowerThirdStyle?: 'standard' | 'minimalist' | 'accent-bar' | 'gradient-bar'
    lowerThirdPosition?: 'left' | 'center' | 'right'
    lowerThirdAccentColor?: string
    lowerThirdSubtitle?: string
}

export interface Advert {
    _id: string
    title: string
    url: string
    image: string
    createdAt: string
    updatedAt: string
}

export interface ExtendedFileT extends File {
    blob?: Blob
    url: string
    isExternal?: boolean
    thumbnail?: string
}

// ==================== Settings Types ====================

export interface DefaultBackgroundConfig {
    backgroundType: string
    background: string
    backgroundVideoKey: string | null
}

export interface AppSettings {
    appVersion: string
    defaultBibleVersion: string
    defaultFont: string
    defaultBackground: {
        default?: DefaultBackgroundConfig
        hymn: DefaultBackgroundConfig
        bible: DefaultBackgroundConfig
        text: DefaultBackgroundConfig
    }
    slideStyles: SlideStyle
    bibleVersions: Array<unknown>
    animations?: boolean
    footnotes?: boolean
    songAndHymnLabelsVisibility: boolean
    liveWindowFullscreen?: boolean
    motionlessSlides?: boolean
    transitionInterval?: number
    alertLimit?: number
    // Default template IDs for slide types
    defaultTemplates?: {
        scripture?: string | null
        hymn?: string | null
        song?: string | null
        text?: string | null
    }
    // Sermon Listener Settings
    sermonListener?: {
        /** Enable sermon listener feature */
        enabled?: boolean
        /** Transcription provider: 'web-speech' | 'whisper' | 'whisper-cpp' | 'elevenlabs' */
        transcriptionProvider?: 'web-speech' | 'whisper' | 'whisper-cpp' | 'elevenlabs'
        /** Whisper model size: 'tiny' | 'base' | 'small' | 'medium' */
        whisperModel?: 'tiny' | 'base' | 'small' | 'medium'
        /** Optional server endpoint for chunked transcription */
        whisperEndpoint?: string
        /** Optional API key for OpenAI-compatible endpoint */
        whisperApiKey?: string
        /** Chunk size in milliseconds for realtime transcription */
        whisperChunkDurationMs?: number
        /** Local whisper.cpp server endpoint */
        whisperCppEndpoint?: string
        /** Chunk size for whisper.cpp local transcription */
        whisperCppChunkDurationMs?: number
        /** ElevenLabs API key */
        elevenLabsApiKey?: string
        /** ElevenLabs model ID */
        elevenLabsModelId?: string
        /** Chunk size for ElevenLabs transcription */
        elevenLabsChunkDurationMs?: number
        /** Auto-display detected verses */
        autoDisplay?: boolean
        /** Auto-lookup detected verses */
        autoLookup?: boolean
        /** Language for speech recognition */
        language?: string
    }
}

// ==================== App State Types ====================

export interface AppState {
    activeAdvert: Advert | null
    schedules: Schedule[]
    activeSchedule: Schedule | null
    activeSlides: Slide[]
    liveOutputSlidesId: string[] | null
    liveSlideId: string | null
    emitter: Emitter<Record<EventType, unknown>> | null
    settings: AppSettings
    backgroundVideos: BackgroundVideo[]
    alerts: Alert[]
    activeAlert: Alert | null
    activeOverlay: string
    recentBibleSearches: string[]
    failedUploadRequests: Array<{ path: string; options: unknown; timestamp: number }>
    slidesLoading: boolean
    lastSynced: string
    bannerVisible: boolean
    bibleVersions: Array<unknown>
    activeSocket: WebSocket | null
    mainDisplayLabel: string
    mainDisplayScreen: Screen | null
}

// ==================== Slide Content Types ====================

export const slideTypes = {
    song: 'song',
    hymn: 'hymn',
    bible: 'bible',
    text: 'text',
    media: 'media',
    countdown: 'countdown',
} as const

export const libraryTypes = {
    song: 'song',
    slide: 'slide',
} as const

export const slideLayoutTypes = {
    heading_sub: 'heading-and-subtitle',
    full_text: 'full-text',
    two_column: 'two-column',
    bible: 'bible',
    countdown: 'countdown',
    empty: 'empty',
    lower_third: 'lower-third',
} as const

export const backgroundTypes = {
    image: 'image',
    video: 'video',
    color: 'color',
    gradient: 'gradient',
} as const

export const backgroundFillTypes = {
    crop: 'crop',
    fit: 'fit',
    stretch: 'stretch',
} as const

// ==================== App Wide Actions ====================

export const appWideActions = {
    liveTransfer: 'live-transfer',
    newText: 'new-text',
    newBible: 'new-bible',
    newHymn: 'new-hymn',
    newSong: 'new-song',
    newSlide: 'new-slide',
    newMedia: 'new-media',
    newYouTubeVideo: 'new-youtube-video',
    newVimeoVideo: 'new-vimeo-video',
    newLibrary: 'new-library',
    newTemplates: 'new-templates',
    newAlert: 'new-alert',
    addSong: 'add-song',
    removeAlert: 'remove-alert',
    newCountdown: 'new-countdown',
    newLowerThird: 'new-lower-third',
    newSearchBible: 'new-search-bible',
    goLive: 'go-live',
    closeLiveWindow: 'close-live-window',
    openSettings: 'open-settings',
    newActiveSlide: 'new-active-slide',
    deleteSlide: 'delete-slide',
    selectSlides: 'select-slides',
    showChangelog: 'show-changelog',
    refreshSlides: 'refresh-slides',
    startCountdown: 'start-countdown',
    restartCountdown: 'restart-countdown',
    stopCountdown: 'stop-countdown',
    mediaSeek: 'media-seek',
    appLoading: 'app-loading',
    gotoVerse: 'goto-verse',
    deleteScheduleSlides: 'delete-schedule-slides',
    selectedSchedule: 'selected-schedule',
    openScheduleModal: 'open-schedule-modal',
    toggleDarkMode: 'toggle-dark-mode',
    joinCommunity: 'join-community',
    openInviteModal: 'open-invite-modal',
    liveSlideIdTransfer: 'live-slide-id-transfer',
    liveActiveSlidesTransfer: 'live-active-slides-transfer',
    liveSettingsTransfer: 'live-settings-transfer',
    quickActionsFocus: 'quick-actions-focus',
    uploadOfflineSlides: 'upload-offline-slides',
    batchUpdateSlides: 'batch-update-slides',
    openShortcutsModal: 'open-shortcuts',
} as const

// ==================== Bible Books ====================

export const bibleBooks = [
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
    'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
    '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
    'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
    'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
    'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
    'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
    'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
    'Matthew', 'Mark', 'Luke', 'John', 'Acts',
    'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
    'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
    '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
    '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
    'Jude', 'Revelation'
] as const

// This is a fallback list of bible versions with copyright info, actual data is gotten from API
export const bibleVersionObjects: BibleVersion[] = [
    {
        id: 'KJV',
        name: 'King James Version',
        isDownloaded: false,
        copyrightContent: 'Scripture taken from the King James Version. Public Domain',
        isPublicDomain: true,
    },
    {
        id: 'ASV',
        name: 'American Standard Version',
        isDownloaded: false,
        copyrightContent: 'Scripture taken from the American Standard Version. Public Domain',
        isPublicDomain: true,
    },
    {
        id: 'YLT',
        name: "Young's Literal Translation",
        isDownloaded: false,
        copyrightContent: "Scripture taken from the Young's Literal Translation. Public Domain",
        isPublicDomain: true,
    },
    {
        id: 'WEB',
        name: 'World English Bible',
        isDownloaded: false,
        copyrightContent: 'Scripture taken from the World English Bible. Public Domain',
        isPublicDomain: true,
    },
    {
        id: 'NKJV',
        name: 'New King James Version',
        isDownloaded: false,
        copyrightContent: 'Scripture taken from the New King James Version®. Copyright © 1982 by Thomas Nelson. All rights reserved.',
        isPublicDomain: false,
    },
    {
        id: 'NIV',
        name: 'New International Version',
        isDownloaded: false,
        copyrightContent: 'Scriptures taken from the Holy Bible, New International Version®, NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ All rights reserved worldwide.',
        isPublicDomain: false,
    },
    {
        id: 'AMP',
        name: 'Amplified Bible',
        isDownloaded: false,
        copyrightContent: 'All Scripture quotations, unless otherwise indicated, are taken from the Amplified Bible, Copyright © 2015 by The Lockman Foundation.',
        isPublicDomain: false,
    },
    {
        id: 'NLT',
        name: 'New Living Translation',
        isDownloaded: false,
        copyrightContent: 'Scripture quotations marked (NLT) are taken from the Holy Bible, New Living Translation, copyright ©1996, 2004, 2015 by Tyndale House Foundation.',
        isPublicDomain: false,
    },
    {
        id: 'CEV',
        name: 'Contemporary English Version',
        isDownloaded: false,
        copyrightContent: 'Scripture quotations marked (CEV) are from the Contemporary English Version Copyright © 1991, 1992, 1995 by American Bible Society.',
        isPublicDomain: false,
    },
    {
        id: 'MSG',
        name: 'The Message',
        isDownloaded: false,
        copyrightContent: 'Scripture taken from THE MESSAGE. Copyright © 1993, 1994, 1995, 1996, 2000, 2001, 2002.',
        isPublicDomain: false,
    },
    {
        id: 'NASB',
        name: 'New American Standard Bible',
        isDownloaded: false,
        copyrightContent: 'Scripture quotations taken from the (NASB®) New American Standard Bible®, Copyright © 1960, 1971 by The Lockman Foundation',
        isPublicDomain: false,
    },
    {
        id: 'TPT',
        name: 'The Passion Translation',
        isDownloaded: false,
        copyrightContent: 'Scripture quotations marked TPT are from The Passion Translation®. Copyright © 2017, 2018, 2020 by Passion & Fire Ministries, Inc.',
        isPublicDomain: false,
    },
    {
        id: 'YBCV',
        name: 'Yoruba YBCV (Bibeli Mimọ)',
        isDownloaded: false,
        copyrightContent: 'Scripture quotations taken from the Yoruba Bible Crowther Version © The Bible Society of Nigeria, 2012',
        isPublicDomain: false,
    },
]

// ==================== Quick Actions ====================

export const quickActionsArr: QuickAction[] = [
    {
        icon: 'i-bx-bible',
        name: 'Display Bible',
        desc: 'Select and open scriptures',
        action: appWideActions.newBible,
        meta: '',
        bibleBookIndex: '1',
        type: slideTypes.bible,
        tier: 'free',
    },
    {
        icon: 'i-bx-search',
        name: 'Search Whole Bible',
        desc: 'Full text search of the scriptures',
        action: appWideActions.newSearchBible,
        meta: '',
        type: slideTypes.bible,
        tier: 'free',
    },
    {
        icon: 'i-bx-church',
        name: 'Display Hymns',
        desc: 'Find verses and chorus to all hymns',
        action: appWideActions.newHymn,
        meta: '',
        type: slideTypes.hymn,
        tier: 'free',
    },
    {
        icon: 'i-lucide-music-2',
        name: 'Add Song',
        desc: 'Save songs to your personal library',
        action: appWideActions.addSong,
        meta: '',
        tier: 'free',
    },
    {
        icon: 'i-bx-library',
        name: 'My Library',
        desc: 'Save your favorite songs, slides',
        action: appWideActions.newLibrary,
        meta: 'save files images pictures videos songs documents',
        type: slideTypes.media,
        tier: 'free',
    },
    {
        icon: 'i-bx-music',
        name: 'Search song lyrics',
        desc: 'Find lyrics to any song, native too',
        action: appWideActions.newSong,
        meta: '',
        type: slideTypes.song,
        tier: 'teams',
    },
    {
        icon: 'i-bx-text',
        name: 'Create Text Slide',
        desc: 'Create slides with notes and more',
        action: appWideActions.newSlide,
        meta: '',
        type: slideTypes.text,
        tier: 'free',
    },
    {
        icon: 'i-bx-image',
        name: 'Add Media',
        desc: 'Display image, video or audio media',
        action: appWideActions.newMedia,
        meta: '',
        type: slideTypes.media,
        tier: 'teams',
    },
    {
        icon: 'i-bx-slideshow',
        name: 'Slide Templates',
        desc: 'Use pre-made, fancy slide templates',
        action: appWideActions.newTemplates,
        meta: 'template preset saved design layout',
        tier: 'teams',
    },
    {
        icon: 'i-bx-bell',
        name: 'Add Banners/Alert',
        desc: 'Notify your audience without disruption',
        action: appWideActions.newAlert,
        meta: '',
        tier: 'teams',
    },
    {
        icon: 'i-bx-trash',
        name: 'Remove Alert',
        desc: 'Remove current alert',
        action: appWideActions.removeAlert,
        searchableOnly: true,
        meta: 'trash alert remove banner',
        tier: 'teams',
    },
    {
        icon: 'i-bx-time',
        name: 'Add Countdown Timer',
        desc: 'Engage your church with countdown',
        action: appWideActions.newCountdown,
        meta: '',
        type: slideTypes.countdown,
        tier: 'teams',
    },
    {
        icon: 'i-lucide-panel-bottom',
        name: 'Add Lower Third',
        desc: 'Display speaker name, title, or reference',
        action: appWideActions.newLowerThird,
        meta: 'lower third name title speaker overlay banner',
        type: slideTypes.text,
        tier: 'teams',
    },
    {
        icon: 'i-mdi-youtube',
        name: 'Add YouTube Video',
        desc: 'Embed YouTube videos in your schedule',
        action: appWideActions.newYouTubeVideo,
        meta: 'youtube external video embed',
        type: slideTypes.media,
        tier: 'teams',
    },
    {
        icon: 'i-mdi-vimeo',
        name: 'Add Vimeo Video',
        desc: 'Embed Vimeo videos in your schedule',
        action: appWideActions.newVimeoVideo,
        meta: 'vimeo external video embed',
        type: slideTypes.media,
        tier: 'teams',
    },
    {
        icon: 'i-bx-cog',
        name: 'Open App Settings',
        desc: 'Customize account, profile, slide, bible settings',
        action: appWideActions.openSettings,
        meta: 'app payment bible slide profile settings',
        tier: 'free',
    },
    {
        icon: 'i-bx-calendar-plus',
        name: 'Create New Schedule',
        desc: 'Start a whole new service project',
        action: appWideActions.openScheduleModal,
        meta: 'new schedule service fresh start',
        tier: 'free',
    },
    {
        icon: 'i-bx-moon',
        name: 'Toggle Dark Mode',
        desc: 'Switch between light and dark theme',
        action: appWideActions.toggleDarkMode,
        meta: 'toggle dark light mode app settings theme',
        searchableOnly: true,
        tier: 'free',
    },
    {
        icon: 'i-bx-user-plus',
        name: 'Invite to Workspace',
        desc: 'Invite teammates to your workspace',
        action: appWideActions.openInviteModal,
        meta: 'teammates share link invite workspace',
        searchableOnly: true,
        tier: 'teams',
    },
    {
        icon: 'i-bxs-keyboard',
        name: 'Shortcuts & Hotkeys',
        desc: 'Open shortcuts and hotkeys modal',
        action: appWideActions.openShortcutsModal,
        meta: 'shortcut Cmd Ctrl hotkey keyboard mouse',
        searchableOnly: true,
        tier: 'free',
    },
]
