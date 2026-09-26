# Improvement plan

What remained after the first improvement pass (September 2026), from seven
reviews of the codebase: Convex backend, live output, sermon listener, state
layer, studio UI, app shell, and the React hooks lint. Status is kept up to
date as items land; the commit messages carry the detail.

Legend: ✅ done · ⏭️ skipped (reason given) · ⬜ not started

## 1. Needs a decision (not code)

- ⬜ Production runs on a Clerk **development** key (`pk_test_…` in `fly.toml`).
  Create a production Clerk instance and use its `pk_live_` key.
- ⬜ Copyrighted translations (NIV, NKJV, NLT, AMP, MSG, TPT, NASB, CEV) are
  publicly downloadable from `/bibles/`. Confirm licences, or serve only
  public-domain versions statically.
- ⬜ Clicking a song title in search results sends it straight to live. Should
  it preview instead?
- ⬜ Deploy: `npx convex deploy` together with the web app; set `SITE_URL` and
  `RESEND_API_KEY` on the Convex deployment; run `nginx -t` or deploy to
  staging first.

## 2. Live session sync

- ✅ `useLiveSession` is mounted in ~10 components and each copy runs the
  operator auto-sync, so one slide edit sends ~10 destructive
  `syncScheduleSlides` calls. Run the sync once.
- ✅ Replace the destructive whole-deck sync with per-slide upsert/delete.
- ✅ Slides deleted by one operator never disappear for others.

## 3. Sermon listener over a long service

- ✅ The audio level re-renders the whole studio ~60 times a second.
- ✅ Each utterance reprocesses the entire transcript (grows with the sermon).
- ✅ Settings changed mid-service are ignored until Stop/Start.
- ✅ Chrome's automatic speech restarts are treated as stop/start: timestamps
  reset and the free-tier 40-minute cap re-arms.
- ✅ Stop pressed during "Starting…" is ignored.
- ✅ A verse-search worker failure disables semantic detection for the rest of
  the service; native transcription errors never reach the UI.
- ✅ Voice commands miss NASB/TPT/YBCV, and "new king james" resolves to KJV.

## 4. Live output polish

- ✅ Slide rendering is copied in four places that have drifted; the operator's
  monitor doesn't match the projector. *The visible differences are fixed (the
  operator's monitor now dims/blurs backgrounds like the projector, and
  countdowns share one clock). Merging the renderers into one component is
  still worth doing, but needs visual checking in a signed-in session.*
- ✅ Pausing or muting a YouTube/Vimeo video restarts it; Restart works once.
- ✅ Motion backgrounds restart and flash black on every lyric slide.
- ✅ Countdown timers drift between the operator and the projector.
- ✅ Media load and autoplay failures are silent.

## 5. Billing robustness

- ⬜ Webhook events are ordered by arrival time, so a late "payment failed" can
  overwrite a success.
- ⬜ A failed intro→full-price rollover is never retried.
- ⬜ An abandoned discount checkout can later double-bill.
- ⬜ The billing return page says "Payment received" even when nothing was paid.

## 6. Data-layer leftovers

- ⬜ Templates deleted elsewhere come back from the local cache.
- ⬜ The saved-slide library has three independent copies; last write wins.
- ⬜ The persisted store has no version/migration; new Bible versions never
  appear for existing installs.
- ⬜ Live-session mutation failures are only logged.

## 7. Engineering hygiene

- ⬜ Clear the lint backlog, then gate CI on lint.
- ⬜ `convex-test` coverage for the backend authorization rules.
- ⬜ Delete ~3,500 lines of unreachable transcription providers and dead
  offline hooks/IndexedDB helpers.
- ⬜ Split the 1.1 MB Dashboard chunk.
- ⬜ Self-host runtime libraries loaded from CDNs (and fix their version
  mismatches), so the desktop app works fully offline.
- ⬜ Content Security Policy, report-only first.

## 8. UI consistency

- ⬜ One shared modal (focus trap, Escape, ARIA) replacing ~20 hand-rolled ones.
- ⬜ Virtualize long song lists.
- ⬜ Settings modal responsive; "More Versions" opens the Bible tab.
- ⬜ Modals use the app's colour tokens; replace native `confirm()`.
