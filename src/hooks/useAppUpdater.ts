/**
 * useAppUpdater — find out an update exists, tell the operator, install on their
 * say-so.
 *
 * The Rust side used to fuse all of that into one `check_update` command that
 * downloaded, installed and restarted as soon as it found a new version. Two
 * problems: there was no moment at which an update was "available but not yet
 * installed", so nothing could announce it — the only way to learn about an
 * update was to open Settings and press a button — and the silent check five
 * seconds after launch could restart the app by itself, potentially mid-service.
 *
 * So `check_update` now only reports, and `install_update` installs. Nothing
 * installs without the operator asking.
 *
 * State is module-level rather than per-hook: the top bar pill and the Settings
 * panel both mount this hook, and they must show the same thing and share one
 * network check.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAnalytics } from "./useAnalytics";
import { AnalyticsEventType } from "../services/analytics/types";

export interface UpdateInfo {
    /** The version on offer, e.g. "0.1.10". */
    version: string;
    /** The version currently running. */
    currentVersion: string;
    /** Release notes from the manifest, if the release supplied any. */
    notes: string | null;
    /** Publish date, ISO 8601. */
    date: string | null;
}

export type UpdateState =
    | "idle"
    | "checking"
    | "up_to_date"
    | "available"
    | "installing"
    | "error";

export interface UseAppUpdaterResult {
    state: UpdateState;
    message: string | null;
    /** The update on offer, or null when there isn't one. */
    available: UpdateInfo | null;
    /** True once the operator has dismissed this specific version. */
    dismissed: boolean;
    /** Check now (e.g. the Settings button). Safe to call repeatedly. */
    runCheck: () => Promise<void>;
    /** Download, install and restart. Only ever called from a user action. */
    install: () => Promise<void>;
    /** Hide the prompt for this version; a newer one will prompt again. */
    dismiss: () => void;
}

/** Remembers which version the operator waved away, so we don't nag. */
const DISMISSED_KEY = "selah-dismissed-update";

/** A booth machine can stay open for days, so re-check periodically. */
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Delay before the first check so it doesn't compete with the initial render. */
const FIRST_CHECK_DELAY_MS = 5_000;

interface Snapshot {
    state: UpdateState;
    message: string | null;
    available: UpdateInfo | null;
    dismissedVersion: string | null;
}

function readDismissed(): string | null {
    try {
        return localStorage.getItem(DISMISSED_KEY);
    } catch {
        return null;
    }
}

let snapshot: Snapshot = {
    state: "idle",
    message: null,
    available: null,
    dismissedVersion: readDismissed(),
};

const listeners = new Set<() => void>();

function publish(patch: Partial<Snapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    return () => {
        listeners.delete(onChange);
    };
}

function getSnapshot(): Snapshot {
    return snapshot;
}

/** Collapses concurrent checks — both consumers mounting at once is one check. */
let checkInFlight: Promise<void> | null = null;
/** The background schedule is per-session, not per-hook-instance. */
let backgroundStarted = false;

function isDesktop(): boolean {
    // `invoke` reads `window.__TAURI_INTERNALS__` synchronously and throws a
    // TypeError when it's missing (the web build), so this has to be checked
    // rather than caught.
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function performCheck(surfaceErrors: boolean): Promise<void> {
    if (checkInFlight) return checkInFlight;

    checkInFlight = (async () => {
        publish({ state: "checking", message: null });
        try {
            const info = await invoke<UpdateInfo | null>("check_update");
            if (info) {
                publish({ state: "available", available: info, message: null });
            } else {
                publish({
                    state: "up_to_date",
                    available: null,
                    message: "You're on the latest version.",
                });
            }
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error).message ?? String(e);
            // A background check failing is normal — the endpoint may be
            // unreachable in a church hall with no wifi. Only an explicit
            // check reports it.
            publish(
                surfaceErrors
                    ? { state: "error", message }
                    : { state: snapshot.available ? "available" : "idle", message: null },
            );
        } finally {
            checkInFlight = null;
        }
    })();

    return checkInFlight;
}

export function useAppUpdater(): UseAppUpdaterResult {
    // useSyncExternalStore rather than a useState mirror: the store is module
    // level and shared by the top bar pill and the Settings panel, and this is
    // the primitive that keeps both consistent with it across renders.
    const local = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const { trackEvent } = useAnalytics();

    const runCheck = useCallback(async () => {
        if (!isDesktop()) {
            publish({
                state: "error",
                message: "Updates are only available in the desktop app.",
            });
            return;
        }
        trackEvent(AnalyticsEventType.DESKTOP_UPDATE_CHECKED);
        await performCheck(true);
    }, [trackEvent]);

    const install = useCallback(async () => {
        if (!isDesktop() || !snapshot.available) return;

        const version = snapshot.available.version;
        publish({ state: "installing", message: null });
        trackEvent(AnalyticsEventType.DESKTOP_UPDATE_INSTALLED, { version });

        try {
            // On success the process is replaced (or, on Windows, exits so the
            // installer can overwrite the binary), so this never returns.
            await invoke("install_update");
        } catch (e) {
            const message = typeof e === "string" ? e : (e as Error).message ?? String(e);
            publish({ state: "error", message });
        }
    }, [trackEvent]);

    const dismiss = useCallback(() => {
        const version = snapshot.available?.version;
        if (!version) return;
        try {
            localStorage.setItem(DISMISSED_KEY, version);
        } catch {
            // Private-mode storage failure just means it prompts again later.
        }
        publish({ dismissedVersion: version });
        trackEvent(AnalyticsEventType.DESKTOP_UPDATE_DISMISSED, { version });
    }, [trackEvent]);

    // One background check per session, then a slow re-check for machines that
    // stay open for days. Errors here stay silent.
    useEffect(() => {
        if (!isDesktop() || backgroundStarted) return;
        backgroundStarted = true;

        const first = setTimeout(() => void performCheck(false), FIRST_CHECK_DELAY_MS);
        const interval = setInterval(() => void performCheck(false), RECHECK_INTERVAL_MS);

        return () => {
            clearTimeout(first);
            clearInterval(interval);
            backgroundStarted = false;
        };
    }, []);

    return {
        state: local.state,
        message: local.message,
        available: local.available,
        dismissed:
            !!local.available && local.dismissedVersion === local.available.version,
        runCheck,
        install,
        dismiss,
    };
}

/** Test seam: drop module state between cases. */
export function __resetAppUpdaterForTests(): void {
    snapshot = { state: "idle", message: null, available: null, dismissedVersion: null };
    listeners.clear();
    checkInFlight = null;
    backgroundStarted = false;
}
