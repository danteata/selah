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
- ⬜ Production web (`fly.toml`) and, by all signs, the desktop app use the
  Convex **dev** deployment `impressive-viper-428`; the production deployment
  `adept-cricket-545` has no functions. Backend changes reach users through
  `npx convex dev`, not `npx convex deploy`. Decide whether to move to the
  production deployment (it needs its data, env vars, the Clerk issuer and
  the Paystack webhook URL pointed at it). `SITE_URL` and `RESEND_API_KEY` are
  not set there: invite links fall back to selah.fly.dev and invite emails
  are not sent.

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

- ✅ Slide rendering was copied in four places that had drifted; the
  operator's monitor didn't match the projector. They now share one
  renderer, `src/components/live/SlideView.tsx`, sized against a 1920px
  frame so every preview is the projector's picture scaled down. The
  alternate output's canvas renderer (NDI) is separate and unchanged.
- ✅ Pausing or muting a YouTube/Vimeo video restarts it; Restart works once.
- ✅ Motion backgrounds restart and flash black on every lyric slide.
- ✅ Countdown timers drift between the operator and the projector.
- ✅ Media load and autoplay failures are silent.

## 5. Billing robustness

- ✅ Webhook events are ordered by arrival time, so a late "payment failed" can
  overwrite a success.
- ✅ A failed intro→full-price rollover is never retried.
- ✅ An abandoned discount checkout can later double-bill.
- ✅ The billing return page says "Payment received" even when nothing was paid.

## 6. Data-layer leftovers

- ✅ Templates deleted elsewhere come back from the local cache.
- ✅ The saved-slide library has three independent copies; last write wins.
- ✅ The persisted store has no version/migration; new Bible versions never
  appear for existing installs.
- ✅ Live-session mutation failures are only logged.

## 7. Engineering hygiene

- ✅ Clear the lint backlog (zero errors), and CI now runs eslint in the
  deploy's verify job.
- ✅ `convex-test` coverage for the backend authorization rules and the
  Paystack webhook (`convex/security.test.ts`, `convex/billing.test.ts`,
  run by `bun run test:convex` and in CI).
- ✅ Deleted the unreachable transcription providers, dead offline hooks and
  the unused VAD/ORT assets in `public/` (16 MB).
- ✅ Split the Dashboard chunk: 1.1 MB → 710 KB. Modals, editors and admin
  panels load on first open; framer-motion and react-grid-layout are
  separate vendor chunks.
- ⏭️ Self-host transformers.js. Skipped: bundling it was tried once and
  failed only at runtime, inside the worker (see the header of
  `embedding.worker.ts`). ORT's wasm and the models also come from other
  hosts, so doing it properly means testing it in a running app.
- ✅ Content Security Policy, report-only (`nginx-security-headers.conf`).
  Watch the reports, then switch it to enforcing.

## 8. UI consistency

- ✅ A shared `Modal` (`src/components/modals/Modal.tsx`) with a focus trap,
  Escape for the topmost dialog only, focus return, a scroll lock and ARIA.
  ConfirmDialog, the shortcuts sheet, the settings modal and the admin panel
  use it, and so does every other dialog. The command bar, quick Bible bar
  and update prompt animate out, so they use the `useDialog` hook directly.
- ✅ Long song and hymn lists: rows use `content-visibility: auto`. That is
  not a windowed list; it keeps keyboard navigation, which finds rows in
  the DOM, working.
- ✅ The settings modal fits short and narrow windows; "More Versions" opens
  it on the Bible page (`openSettings('bible')`).
- ✅ Native `confirm()` replaced by ConfirmDialog everywhere. The migrated
  dialogs' chrome uses the colour tokens. Slide previews keep their own
  colours, since those are content.

## 9. Found while making the demo video (2026-09-28)

- ✅ The projector showed only black in 0.1.23 (renderer box 0px tall). Fixed and shipped in 0.1.24.
- ✅ A service order prepared outside a live session was never saved (every release). Shipped in 0.1.24.
- ✅ Song slides from the library were rejected on save (strict `slides` schema), so services with songs never synced. Shipped in 0.1.24.
- ✅ Lyric line breaks were lost; each sung line now stays on one line and the text fits the longest. Web now; desktop in the next release.
- ✅ Uploaded video backgrounds (web) were blob links that died with the tab; now stored in the local media library, and the pointer survives a reload. Web now; desktop next release.
- ✅ Next Up counted a waiting countdown down early; the countdown form ran off a narrow panel.
- ✅ Phone view: the studio ran off the right edge (grid blowout), and the status bar covered the bottom navigation.
- ✅ ⌘K only searched commands although the top bar promises songs and the Bible; it now hands the query to Songs or the Bible.
- ✅ A failed save of the service order now retries on its own (5 s, 15 s, then every minute).
- ✅ One countdown slide builder instead of two copies.
- ✅ Landing page: "Watch it work" plays the demo (public/selah-demo.mp4, 7 MB).
- ⬜ Decision: `public/songs/easyworship.json` ships a song library that includes likely copyrighted songs (e.g. "Awesome God"), the same licensing question as the Bibles in section 1.
- ⬜ Two operator tabs on one machine both write to the same projector channel, and a stale one can clear the live slide.
- ⬜ The desktop app hasn't had a release with the web-only fixes above (lyric fitting, background pointers, phone layout, search, save retry): next desktop release.
