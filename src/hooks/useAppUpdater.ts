/**
 * useAppUpdater — thin wrapper around the Tauri `check_update` command.
 *
 * 1. On mount, runs a silent check after a 5 s delay so the initial render
 *    is not blocked.
 * 2. Exposes `runCheck()` so a "Check for updates" button can trigger an
 *    on-demand check from the settings UI.
 * 3. Errors are surfaced as a string for toasts; the `running` flag drives
 *    button disabled state.
 *
 * The Rust `check_update` command handles the full flow: fetch manifest,
 * verify signature against the embedded pubkey, download, install, and
 * `app.restart()`.  If no update is available, it returns "up to date".
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type UpdateState =
    | "idle"
    | "checking"
    | "up_to_date"
    | "downloading"
    | "restarting"
    | "error";

export interface UseAppUpdaterResult {
    state: UpdateState;
    message: string | null;
    /** Manually trigger an update check (e.g. from a settings page button). */
    runCheck: () => Promise<void>;
}

export function useAppUpdater(): UseAppUpdaterResult {
    const [state, setState] = useState<UpdateState>("idle");
    const [message, setMessage] = useState<string | null>(null);

    const runCheck = useCallback(async () => {
        if (state === "checking" || state === "downloading" || state === "restarting") {
            return;
        }
        setState("checking");
        setMessage(null);
        try {
            const result = await invoke<string>("check_update");
            // `check_update` only returns Ok() on two paths: "up to date" (no
            // restart) or after `app.restart()` (no return at all).  If we got
            // here, the app did not restart, so the user is up to date.
            if (result === "up to date") {
                setState("up_to_date");
                setMessage("You're on the latest version.");
            } else {
                setState("restarting");
            }
        } catch (e) {
            setState("error");
            setMessage(typeof e === "string" ? e : (e as Error).message ?? String(e));
        }
    }, [state]);

    // Silent background check 5 s after mount.  We delay so we don't compete
    // with the initial React render, and we don't surface errors from this
    // pass — only the on-demand check shows error toasts.
    useEffect(() => {
        const t = setTimeout(() => {
            invoke<string>("check_update")
                .then((result) => {
                    if (result === "up to date") {
                        setState((s) => (s === "idle" ? "up_to_date" : s));
                    }
                })
                .catch(() => {
                    // Silent — the endpoint may be unreachable on first run.
                });
        }, 5_000);
        return () => clearTimeout(t);
    }, []);

    return { state, message, runCheck };
}
