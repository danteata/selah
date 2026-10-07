import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { persistClerkDevBrowser } from '../clerkSessionPersistence'

const DEV_KEY = 'pk_test_cG9saXRlLWFkZGVyLTguY2xlcmsuYWNjb3VudHMuZGV2JA'
const STORAGE_KEY = 'selah:clerk-dev-browser'

function fapiRequest(token: string | null): { url: URL } {
    const url = new URL('https://polite-adder-8.clerk.accounts.dev/v1/client')
    if (token) url.searchParams.set('__clerk_db_jwt', token)
    return { url }
}

describe('persistClerkDevBrowser', () => {
    beforeEach(() => {
        ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
        localStorage.clear()
        window.history.replaceState(null, '', '/#/')
        delete window.__unstable__onAfterResponse
    })

    afterEach(() => {
        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        delete window.__unstable__onAfterResponse
    })

    it('saves the token clerk-js sends with its requests', async () => {
        persistClerkDevBrowser(DEV_KEY)
        await window.__unstable__onAfterResponse!(fapiRequest('dvb_first'), { headers: new Headers() })
        expect(localStorage.getItem(STORAGE_KEY)).toBe('dvb_first')
    })

    it('prefers a rotated token from the response header', async () => {
        persistClerkDevBrowser(DEV_KEY)
        await window.__unstable__onAfterResponse!(fapiRequest('dvb_old'), {
            headers: new Headers({ 'Clerk-Db-Jwt': 'dvb_new' }),
        })
        expect(localStorage.getItem(STORAGE_KEY)).toBe('dvb_new')
    })

    it('hands the saved token to clerk-js on the next launch, keeping the route', () => {
        localStorage.setItem(STORAGE_KEY, 'dvb_saved')
        window.history.replaceState(null, '', '/#/settings')
        persistClerkDevBrowser(DEV_KEY)
        const url = new URL(window.location.href)
        expect(url.searchParams.get('__clerk_db_jwt')).toBe('dvb_saved')
        expect(url.hash).toBe('#/settings')
    })

    it('leaves a token already in the URL alone', () => {
        localStorage.setItem(STORAGE_KEY, 'dvb_saved')
        window.history.replaceState(null, '', '/?__clerk_db_jwt=dvb_url#/')
        persistClerkDevBrowser(DEV_KEY)
        expect(new URL(window.location.href).searchParams.getAll('__clerk_db_jwt')).toEqual(['dvb_url'])
    })

    it('does nothing on the web or with a production key', () => {
        localStorage.setItem(STORAGE_KEY, 'dvb_saved')
        persistClerkDevBrowser('pk_live_abc')
        expect(window.location.search).toBe('')
        expect(window.__unstable__onAfterResponse).toBeUndefined()

        delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
        persistClerkDevBrowser(DEV_KEY)
        expect(window.location.search).toBe('')
        expect(window.__unstable__onAfterResponse).toBeUndefined()
    })
})
