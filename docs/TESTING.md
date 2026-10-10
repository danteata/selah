# Testing

| Suite | Command | Runs in | What it covers |
|---|---|---|---|
| Unit | `bun run test` | happy-dom (Vitest), plus the Convex suite | Logic, hooks, components |
| Golden images | `bun run test:golden` | Headless Chromium (Vitest browser mode) | What the output actually looks like |
| Rust | `cargo test` in `src-tauri` | Native | Audio capture, transcription, NDI, embeddings |

CI (`.github/workflows/ci.yml`) runs all three on every pull request.

## Golden-image tests

A golden test renders something in real Chromium and compares it with a PNG
committed next to the test, in `__goldens__/`. They catch changes the unit tests
can't: a motion background that drifts, a font that stops loading, a lower third
that moves.

Today they cover:

- each motion background at t = 12 s;
- the canvas renderer behind the alternate/NDI output: lyrics, scripture, a lower
  third, a transparent frame, Twi text, and two templates;
- `SlideView` itself, the DOM the projector shows.

Test files end in `.golden.test.ts(x)`. The unit suite skips them.

```ts
import { expectGolden, goldenCanvas, requireFont } from '../../../test/golden/golden'

await requireFont('Inter')               // fail rather than render in a fallback font
await expectGolden('slide-lyric', canvas, 'render')
```

There are two tolerances:

- `exact`: no pixel may differ. Use it for pure functions of a seed and a time,
  such as the motion backgrounds.
- `render`: up to 0.1% of pixels may differ. Use it for anything with text,
  where anti-aliasing shifts slightly between Chromium builds.

When a comparison fails, the run writes
`test-results/golden/<name>.{actual,expected,diff}.png`. CI uploads them as the
`golden-diffs` artifact.

### Re-recording

When a change to the output is intended, re-record the goldens it touches and
commit them:

```sh
SELAH_BLESS=1 bun run test:golden
```

Record inside the Playwright image CI uses, so the goldens match what CI
renders. Keep its tag equal to the `playwright` devDependency:

```sh
docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.64.0-noble \
  sh -c 'npm i -g bun && bun install && SELAH_BLESS=1 bun run test:golden'
```

Goldens over 200 KB are refused, so render at golden size (640×360, or
320×180 for the motion backgrounds).

The setup comes from filmcraft's golden tests (MIT OR Apache-2.0, ArtCraft Team
and the FilmCraft contributors).
