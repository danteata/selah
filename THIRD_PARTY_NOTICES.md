# Third-party notices

Code in Selah that is ported from, or depends on, other open-source projects,
with its licence.
Fonts are listed separately, in THIRD_PARTY_FONTS.md.

## EffectCraft

<https://github.com/storytold/effectcraft>, licensed MIT OR Apache-2.0; used here
under MIT.

- `src/lib/animation/keyframe.ts`: from `crates/keyframe/src/lib.rs` (temporal
  keyframe interpolation)
- `src/lib/animation/textSelectors.ts`: from `crates/text/src/selectors.rs`
  (text range selectors)

```
MIT License

Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeckCraft

<https://github.com/storytold/deckcraft>, licensed MIT OR Apache-2.0; used here
under MIT.

- `src/lib/animation/wordMorph.ts`: the Morph transition's word matching and
  motion, from `crates/render/src/morph_text.rs`
- PowerPoint import in the desktop app (`src-tauri/src/pptx_import.rs`) uses
  the `deckcraft-pptx` and `deckcraft-model` crates, unmodified, at commit
  `84acb49895c8190396b686c1eb9f20c730e48633`
- the font substitution table in `src/lib/import/pptxToSlides.ts` is modelled
  on DeckCraft's `substitutes()` (`crates/fonts/src/fontdb.rs`), cut down to the
  fonts Selah ships

```
MIT License

Copyright (c) 2026 ArtCraft Team and the DeckCraft contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
