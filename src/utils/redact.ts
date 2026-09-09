/**
 * Keep spoken text readable while developing, and out of logs everywhere else.
 *
 * Selah's microphone hears a room, not a user: a sermon, congregational
 * prayer, a testimony, children. A transcript is therefore not ordinary
 * diagnostic output — it is the content the audio pipeline's consent rules
 * exist to protect, and a log is outside them. Console output survives in
 * terminal scrollback and in whatever an operator pastes into a bug report.
 *
 * `vite.config.ts` drops `console.log`/`debug`/`info` from production builds,
 * which covers most log sites. It does not cover `console.warn` or
 * `console.error` — and reaching for `warn` precisely so a line survives that
 * stripping is how a transcript ends up in a release build. Wrap the text
 * rather than trusting the level to protect it.
 *
 * The length is kept because it is what makes a log line still useful: it
 * separates "heard nothing" from "heard a sentence and failed to match it".
 *
 * Not for secrets such as API keys or tokens — those must never be logged in
 * any build, so there is nothing to make conditional.
 */
export function redactSpeech(text: string): string {
    if (import.meta.env.DEV) return JSON.stringify(text)
    return `[redacted ${text.length} chars]`
}
