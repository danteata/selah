/**
 * Type declarations for Presentation API and Screen Enumeration API
 * These are not included in TypeScript's default lib
 */

// Presentation API
interface PresentationConnection {
    id: string
    state: 'connected' | 'closed' | 'terminated'
    onclose: () => void
    onconnect: () => void
    onterminate: () => void
    send(data: string): void
    close(): void
    terminate(): void
}

interface PresentationConnectionAvailableEvent extends Event {
    connection: PresentationConnection
}

declare class PresentationRequest {
    constructor(urls: string | string[])
    start(): Promise<PresentationConnection>
    reconnect(): Promise<PresentationConnection>
    getAvailability(): Promise<PresentationAvailability>
    onconnectionavailable: (event: PresentationConnectionAvailableEvent) => void
}

interface PresentationAvailability {
    value: boolean
    onchange: () => void
}

interface Presentation {
    defaultRequest: PresentationRequest | null
    receiver: PresentationReceiver | null
}

interface PresentationReceiver {
    connectionList: Promise<PresentationConnectionList>
}

interface PresentationConnectionList {
    connections: PresentationConnection[]
    onconnectionavailable: (event: Event) => void
}

// Extend Navigator
interface Navigator {
    presentation?: Presentation
}

// Screen Enumeration API (experimental)
interface ScreenDetailed {
    width: number
    height: number
    left: number
    top: number
    isPrimary: boolean
    isInternal: boolean
    label: string
}

interface ScreenDetails {
    screens: ScreenDetailed[]
    currentScreen: ScreenDetailed
}

declare function getScreenDetails(): Promise<ScreenDetails>

interface Window {
    getScreenDetails?: () => Promise<ScreenDetails>
}

// Extend Screen for extended properties
interface Screen {
    left?: number
    top?: number
    isPrimary?: boolean
    isExtended?: boolean
}