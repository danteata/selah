# Third-party notices

Selah includes the open source code listed here. Fonts the app ships for
slides are listed separately in [THIRD_PARTY_FONTS.md](THIRD_PARTY_FONTS.md).

## DeckCraft

PowerPoint import in the desktop app (`src-tauri/src/pptx_import.rs`) uses the
`deckcraft-pptx` and `deckcraft-model` crates from
[storytold/deckcraft](https://github.com/storytold/deckcraft), at commit
`84acb49895c8190396b686c1eb9f20c730e48633`, unmodified. DeckCraft is licensed
under the MIT License or the Apache License 2.0, at your option; Selah uses it
under the MIT License:

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

The font substitution table in `src/lib/import/pptxToSlides.ts` is modelled on
DeckCraft's `substitutes()` (`crates/fonts/src/fontdb.rs`), cut down to the
fonts Selah ships.
