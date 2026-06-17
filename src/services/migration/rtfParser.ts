/**
 * RTF Parser for EasyWorship Lyrics
 * 
 * EasyWorship stores lyrics in RTF format. This parser extracts
 * plain text from RTF content.
 */

// Destination words that should be skipped entirely (their content is not text).
// Only real RTF destinations go here. EasyWorship emits "SD" prefixes like
// `\sdewparatemplatestyle101` or `\sdfsreal 60` as bare control words with
// numeric parameters — they are NOT destinations even though the original
// parser treated them as such. When they appear in their real destination
// form (`{\*\sdfsreal 60}`), the `\*` flag below handles skipping the group.
const DESTINATION_WORDS = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'listtable', 'listoverridetable',
    'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr',
    'headerf', 'footerl', 'footerr', 'footerf', 'footnote', 'ftnsep',
    'ftnsepc', 'ftncn', 'annotation', 'xe', 'tc', 'td', 'nonshppict',
    'pnseclvl', 'author', 'title', 'subject', 'keywords', 'comment',
    'operator', 'company', 'manager', 'doccomm', 'creatim', 'revtim',
    'printim', 'buptim', 'version', 'edmins', 'nofpages', 'nofwords',
    'nofchars', 'nofcharsws', 'id', 'vern', 'pntxtb', 'pntxta',
]);

// EasyWorship-specific control words that indicate hidden/slides-only content.
// These paragraphs contain labels like "Slide 1", "Slide 2" that should not
// appear in the final lyrics text. They mark presentation slide boundaries,
// not song content.
const EW_HIDDEN_PARAGRAPH_WORDS = new Set([
    'sdparawysiwghidden',
])

// EasyWorship data-bearing control words whose value (numeric parameter OR
// space-prefixed value) is style metadata, not lyrics. When the value is a
// numeric parameter (e.g. `\fs130`) the parser's standard parameter reader
// consumes it. But EasyWorship sometimes writes these with a space-prefixed
// decimal value (e.g. `\sdasbaseline 166.66667175293` or even
// `\sdasbaseline 48.5999984741211TITLE`). Without this list, the parser
// leaves the value (and anything after it on the same line) in the output,
// producing garbage like `48.5999984741211TITLE` in the lyrics. The exact
// list was derived by diffing the parsed output against ground-truth lyrics
// for `Joy Overflow - Joe Praise` and other EasyWorship 6/7 exports.
const EW_DATA_BEARING_WORDS = new Set([
    'sdasfactor',
    'sdasbaseline',
    'sdastextstyle',
    'sdasalign',
    'sdascolor',
    'sdasfont',
    'sdaslanguage',
    'sdfsreal',
    'sdfsdef',
    'sdfsauto',
    'sdewparatemplatestyle',
    'sdewtemplatestyle',
    'sdlistlevel',
    'sdslidemarker',
    'sdparabasedon',
    'sdtitlestyle',
    'sdsubtitlestyle',
    'sdauthorstyle',
    'sdfooterstyle',
])

// Slide delimiter marker emitted by parseRTF when a hidden paragraph ends.
// This creates verse boundaries for EasyWorship "Slide N" format songs where
// each slide corresponds to one lyric line/section.
export const SLIDE_DELIMITER = '\n---SLIDE---\n';


/**
 * Parse RTF content and extract plain text
 * 
 * @param rtf - RTF formatted string
 * @returns Plain text with verse markers preserved
 */
export function parseRTF(rtf: string): string {
    if (!rtf || typeof rtf !== 'string') {
        return '';
    }

    // Check if it's actually RTF
    if (!rtf.startsWith('{\\rtf')) {
        // Not RTF, return as-is (might be plain text)
        return rtf.trim();
    }

    let result = '';
    let i = 0;
    const len = rtf.length;

    // Track group depth for skipping destinations
    let groupDepth = 0;
    let skipDepth = -1; // Depth at which we started skipping
    let skipNextGroup = false; // Flag to skip the next group (for \* destinations)
    let inHiddenParagraph = false; // Track EasyWorship hidden paragraphs (\sdparawysiwghidden)

    // After an EasyWorship data-bearing control word (e.g. \sdasbaseline
    // 166.66667175293), the value is style metadata, not lyrics. When the
    // value is a numeric parameter, the parameter reader consumes it. But
    // when the value is space-prefixed (e.g. `\sdasbaseline 48.6TITLE`),
    // we need to consume everything up to the next whitespace boundary so
    // the value doesn't leak into the output as garbage text.
    let skipUntilWhitespace = false;

    while (i < len) {
        const char = rtf[i];

        if (char === '{') {
            groupDepth++;
            // Check if we should skip this group due to \* marker
            if (skipNextGroup && skipDepth === -1) {
                skipDepth = groupDepth;
            }
            skipNextGroup = false;
            // A data-bearing value can't span a group boundary.
            skipUntilWhitespace = false;
            i++;
        } else if (char === '}') {
            if (skipDepth === groupDepth) {
                // End of skipped destination
                skipDepth = -1;
            }
            // Note: do NOT reset inHiddenParagraph on '}' — the \sdparawysiwghidden
            // property persists until the next \par, regardless of group nesting.
            groupDepth--;
            // A data-bearing value can't span a group boundary.
            skipUntilWhitespace = false;
            i++;
        } else if (char === '\\') {
            // Parse control word
            const parsed = parseControlWord(rtf, i);
            i = parsed.newIndex;

            // \* is a special destination marker that means "skip if
            // unrecognized". Skip the rest of the current group — this
            // handles both `{\*\foo}` (body-only) and EasyWorship's
            // `{\*\foo 60}` (name + parameter inline) forms.
            if (parsed.text === '*') {
                if (skipDepth === -1) {
                    skipDepth = groupDepth;
                }
            }
            // Check if this is an EasyWorship hidden paragraph marker
            else if (EW_HIDDEN_PARAGRAPH_WORDS.has(parsed.text.toLowerCase())) {
                // Mark that we're in a hidden paragraph — skip all content
                // until the next \par or end of paragraph group
                inHiddenParagraph = true;
            }
            // Check if this is an EasyWorship data-bearing control word
            // whose value should be dropped from the output
            else if (EW_DATA_BEARING_WORDS.has(parsed.text.toLowerCase())) {
                // If parseControlWord consumed a numeric parameter, the
                // value lives in the parameter — nothing more to skip.
                // If no parameter was present, the value is the next
                // printable run up to the next whitespace/control
                // sequence (e.g. `\sdasbaseline 48.5999984741211TITLE`).
                if (!parsed.hadNumericParam) {
                    skipUntilWhitespace = true;
                }
            }
            // Check if we should skip this destination
            else if (parsed.isDestination && skipDepth === -1) {
                skipDepth = groupDepth;
            } else if (skipDepth === -1 && !inHiddenParagraph) {
                // Not skipping and not in hidden paragraph - process the control word
                if (parsed.text === 'par' || parsed.text === 'line') {
                    result += '\n';
                    // Structural paragraph break ends any in-progress
                    // data-bearing value skip.
                    skipUntilWhitespace = false;
                } else if (parsed.text === 'tab') {
                    result += '\t';
                } else if (parsed.char) {
                    // Filter out control characters (0x00-0x1F except tab/newline)
                    // that come from Unicode escapes like \u0? \u2? etc.
                    const code = parsed.char.charCodeAt(0);
                    if (code >= 0x20 || code === 0x0A || code === 0x0D || code === 0x09) {
                        result += parsed.char;
                    }
                }
            }             else if (inHiddenParagraph && (parsed.text === 'par' || parsed.text === 'line')) {
                // \par inside hidden paragraph ends the hidden scope.
                // Emit a slide delimiter instead of a plain newline. This creates
                // proper verse boundaries for EasyWorship "Slide N" format songs where
                // each hidden paragraph marks a slide boundary.
                result += SLIDE_DELIMITER;
                inHiddenParagraph = false;
                skipUntilWhitespace = false;
            }
        } else if (char === '\n' || char === '\r') {
            // Skip newlines in RTF source
            i++;
        } else if (skipUntilWhitespace && (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\\' || char === '{' || char === '}')) {
            // Any whitespace, newline, or control character terminates the
            // data-bearing value skip. We don't reset on the value chars
            // themselves (the printable branch handles that).
            skipUntilWhitespace = false
            // Re-process this char against the other branches by falling
            // through to the bottom — but since we already incremented
            // here, manually rewind.
            // (Easier: just consume it; the next iteration handles the
            // next char. A lone trailing space is harmless.)
            i++
        } else if (skipDepth === -1 && !inHiddenParagraph && isPrintable(char)) {
            // Regular text character (not in skipped destination or hidden paragraph)
            if (skipUntilWhitespace) {
                // Consume the space-prefixed value of a data-bearing
                // control word, stopping at the next whitespace or
                // control sequence. Stopping at whitespace (rather than
                // a fixed length) keeps the parser robust against
                // variable-width decimal values and the `WORD` text
                // that often follows them in EasyWorship exports
                // (e.g. "48.5999984741211TITLE").
                i++
            } else {
                result += char;
                i++;
            }
        } else {
            i++;
        }
    }

    // Sanitize (unpaired surrogates / control chars) but keep the
    // ---SLIDE--- markers — callers that need clean lyrics text call
    // cleanRTFOutput() themselves, which strips the markers.
    return sanitizeString(result)
}

/**
 * Parse an RTF control word starting at the given index
 */
function parseControlWord(
    rtf: string,
    startIndex: number
): { text: string; newIndex: number; char: string; isDestination: boolean; hadNumericParam: boolean } {
    let i = startIndex + 1; // Skip the backslash
    const len = rtf.length;

    if (i >= len) {
        return { text: '', newIndex: i, char: '', isDestination: false, hadNumericParam: false };
    }

    const char = rtf[i];

    // Escaped special characters: \\, \{, \}
    if (char === '\\' || char === '{' || char === '}') {
        return { text: '', newIndex: i + 1, char: char, isDestination: false, hadNumericParam: false };
    }

    // \* is a destination marker (skip if unrecognized)
    if (char === '*') {
        return { text: '*', newIndex: i + 1, char: '', isDestination: false, hadNumericParam: false };
    }

    // Hex escape: \'XX
    if (char === "'") {
        i++;
        if (i + 1 < len) {
            const hex = rtf.slice(i, i + 2);
            const code = parseInt(hex, 16);
            if (!isNaN(code)) {
                return {
                    text: '',
                    newIndex: i + 2,
                    char: decodeWindows1252Char(code),
                    isDestination: false,
                    hadNumericParam: true,
                };
            }
        }
        return { text: '', newIndex: i, char: '', isDestination: false, hadNumericParam: false };
    }

    // Unicode escape: \uN
    if (char === 'u') {
        i++;
        let numStr = '';

        if (i < len && rtf[i] === '-') {
            numStr = '-';
            i++;
        }

        while (i < len && isDigit(rtf[i])) {
            numStr += rtf[i];
            i++;
        }

        if (numStr && numStr !== '-') {
            const code = parseInt(numStr, 10);
            if (!isNaN(code)) {
                // Skip replacement character
                if (i < len && rtf[i] === '?') {
                    i++;
                } else if (i < len && rtf[i] === '\\' && i + 1 < len && rtf[i + 1] === "'") {
                    i += 4; // Skip \'XX
                }

                return {
                    text: '',
                    newIndex: i,
                    char: String.fromCharCode(code),
                    isDestination: false,
                    hadNumericParam: true,
                };
            }
        }
        return { text: '', newIndex: i, char: '', isDestination: false, hadNumericParam: false };
    }

    // Read control word name
    let word = '';
    while (i < len && isLetter(rtf[i])) {
        word += rtf[i];
        i++;
    }

    // Read optional numeric parameter
    let hadNumericParam = false;
    if (i < len && (rtf[i] === '-' || isDigit(rtf[i]))) {
        hadNumericParam = true;
        if (rtf[i] === '-') {
            i++;
        }
        while (i < len && isDigit(rtf[i])) {
            i++;
        }
    }

    // Skip space delimiter after control word
    if (i < len && rtf[i] === ' ') {
        i++;
    }

    // Check if this is a destination marker
    const isDestination = DESTINATION_WORDS.has(word.toLowerCase());

    return { text: word, newIndex: i, char: '', isDestination, hadNumericParam };
}

/**
 * Decode Windows-1252 character to Unicode
 */
function decodeWindows1252Char(code: number): string {
    // Windows-1252 to Unicode mapping for characters 0x80-0x9F
    const windows1252Map: Record<number, string> = {
        0x80: '\u20AC', // Euro sign
        0x82: '\u201A', // Single low-9 quotation mark
        0x83: '\u0192', // Latin small letter f with hook
        0x84: '\u201E', // Double low-9 quotation mark
        0x85: '\u2026', // Horizontal ellipsis
        0x86: '\u2020', // Dagger
        0x87: '\u2021', // Double dagger
        0x88: '\u02C6', // Modifier letter circumflex accent
        0x89: '\u2030', // Per mille sign
        0x8A: '\u0160', // Latin capital letter S with caron
        0x8B: '\u2039', // Single left-pointing angle quotation mark
        0x8C: '\u0152', // Latin capital ligature OE
        0x8E: '\u017D', // Latin capital letter Z with caron
        0x91: '\u2018', // Left single quotation mark
        0x92: '\u2019', // Right single quotation mark
        0x93: '\u201C', // Left double quotation mark
        0x94: '\u201D', // Right double quotation mark
        0x95: '\u2022', // Bullet
        0x96: '\u2013', // En dash
        0x97: '\u2014', // Em dash
        0x98: '\u02DC', // Small tilde
        0x99: '\u2122', // Trade mark sign
        0x9A: '\u0161', // Latin small letter s with caron
        0x9B: '\u203A', // Single right-pointing angle quotation mark
        0x9C: '\u0153', // Latin small ligature oe
        0x9E: '\u017E', // Latin small letter z with caron
        0x9F: '\u0178', // Latin capital letter Y with diaeresis
    };

    if (windows1252Map[code]) {
        return windows1252Map[code];
    }

    // Standard ASCII or Latin-1
    return String.fromCharCode(code);
}

// Replace lone surrogates and other invalid-Unicode characters with U+FFFD.
// Convex's v.string() rejects strings containing unpaired UTF-16 surrogates
// (they break the websocket encoder, producing "unexpected end of hex escape"
// errors). EasyWorship RTF occasionally emits `\uD8XX` / `\uDCXX` codes for
// private-use glyphs that have no Unicode equivalent — sanitize them so the
// downstream Convex payload stays valid.
function sanitizeString(text: string): string {
    return text.replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD\uFEFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g,
        '',
    )
}

/**
 * Clean up the parsed RTF output
 */
function cleanRTFOutput(text: string): string {
    return sanitizeString(text)
        // Remove slide delimiters (structural markers, not lyrics content)
        .replace(/\n---SLIDE---\n/g, '\n')
    // Remove "Slide N" labels (EasyWorship presentation markers) — case insensitive.
    // These are slide delimiters, not verse content. Verse labels like "Verse 1",
    // "Chorus" etc. are preserved because extractVerseStructureFromRTF uses them
    // to split verses and then they appear as labels in the output structure.
    .replace(/^Slide\s+\d+\s*$/gim, '')
    // Remove standalone "Repeat" labels (presentation annotations)
    .replace(/^Repeat\s*$/gim, '')
        // Fix broken apostrophe contractions where RTF source had \\m etc.
        // These come from EasyWorship encoding \' as \\ followed by a letter,
        // producing \m \t \s etc. in the parsed output instead of 'm 't 's.
        .replace(/\\([mMdDtTsSlLvV])\b/g, "'$1")
    // Remove multiple consecutive spaces
    .replace(/ {2,}/g, ' ')
    // Remove replacement character (from bad Unicode encoding in source)
    .replace(/\uFFFD/g, '')
    // Remove spaces at the start of lines
    .replace(/^ +/gm, '')
        // Remove spaces at the end of lines
        .replace(/ +$/gm, '')
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove excessive blank lines (more than 2 consecutive)
        .replace(/\n{3,}/g, '\n\n')
        // Trim the whole thing
        .trim();
}

/**
 * Helper functions
 */
function isLetter(char: string): boolean {
    return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

function isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
}

function isPrintable(char: string): boolean {
    const code = char.charCodeAt(0);
    // Reject null bytes, control characters, and replacement character
    if (code === 0 || code === 0xFFFD || (code < 32 && code !== 10 && code !== 13 && code !== 9)) {
        return false;
    }
    // Also reject BOM and other zero-width characters that shouldn't appear in lyrics
    if (code === 0xFEFF) {
        return false;
    }
    // Allow printable ASCII (space through tilde) plus common Unicode
    // characters found in song lyrics (em dash, smart quotes, etc.)
    return (code >= 32 && code < 127) || // Basic printable ASCII
           code === 0x2013 || // En dash
           code === 0x2014 || // Em dash
           code === 0x2018 || // Left single quotation mark
           code === 0x2019 || // Right single quotation mark
           code === 0x201C || // Left double quotation mark
           code === 0x201D || // Right double quotation mark
           code === 0x2026 || // Horizontal ellipsis
           code >= 0x00C0;    // Latin-1 Supplement and beyond (accented chars, etc.)
}

/**
 * Extract verse structure from RTF lyrics
 * EasyWorship uses labels like "Verse 1", "Chorus", etc. in the text,
 * or hidden paragraph boundaries (\sdparawysiwghidden) for "Slide N" format.
 */
export function extractVerseStructureFromRTF(rtfText: string): {
    label: string;
    content: string;
}[] {
    const parsedText = parseRTF(rtfText);

    // Run all candidate strategies and pick the best result, rather than
    // committing to the first one that returns verses. EasyWorship exports
    // songs in two layouts, and the same RTF can carry both signals:
    //   - "Label" format: explicit `Verse 1`, `Chorus`, etc. lines
    //   - "Slide N" format: `\sdparawysiwghidden` per-line markers
    // When labels are present, they always reflect the songwriter's intent
    // better than slide boundaries (a chorus split across 4 slides should
    // stay one chorus). We only fall back to slide boundaries when no
    // labels exist at all.
    const byLabels = extractByLabels(parsedText)
    if (byLabels.length > 0) return byLabels

    const bySlides = extractBySlides(parsedText)
    if (bySlides.length > 0) return bySlides

    // Strategy 3: If no labels or slide markers, split by blank lines.
    return extractByBlankLines(parsedText)
}

/**
 * Strategy: verse labels (Verse 1, Chorus, Bridge, etc.) on their own lines.
 * Returns [] if no labels are detected so callers can fall back to
 * slide-based or blank-line grouping.
 */
function extractByLabels(parsedText: string): { label: string; content: string }[] {
    const plainText = cleanRTFOutput(parsedText)
    const versePattern = /^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending|Refrain|Altar Call)\s*(\d*)\s*$/im

    const lines = plainText.split('\n')
    const verses: { label: string; content: string }[] = []
    let currentLabel = ''
    let currentContent: string[] = []
    let labelMatched = false

    for (const line of lines) {
        const trimmedLine = line.trim()
        const match = trimmedLine.match(versePattern)

        if (match) {
            labelMatched = true
            if (currentContent.length > 0 || currentLabel) {
                verses.push({
                    label: currentLabel,
                    content: currentContent.join('\n').trim(),
                })
            }
            currentLabel = match[1] + (match[2] ? ` ${match[2]}` : '')
            currentContent = []
        } else if (trimmedLine) {
            currentContent.push(trimmedLine)
        }
    }

    if (currentContent.length > 0 || currentLabel) {
        verses.push({
            label: currentLabel,
            content: currentContent.join('\n').trim(),
        })
    }

    // Only return the grouped verses if at least one explicit label was
    // matched. Without a label match, this is plain text with no verse
    // structure — fall through to the next strategy instead of bundling
    // everything into one unlabeled verse.
    return labelMatched ? verses : []
}

/**
 * Strategy: EasyWorship "Slide N" format, where `parseRTF` emits a
 * `---SLIDE---` marker at each `\sdparawysiwghidden` boundary. Each slide
 * becomes a verse. Returns [] if no slide markers exist.
 */
function extractBySlides(parsedText: string): { label: string; content: string }[] {
    if (!parsedText.includes('---SLIDE---')) return []

    const slides = parsedText
        .split('---SLIDE---')
        .map(s => s.trim())
        .filter(s => s.length > 0)

    if (slides.length === 0) return []

    return slides.map((slideContent, i) => {
        // A slide may itself start with a verse label (e.g. "Slide 1" runs
        // were sometimes pre-typed with "Verse 1" text in EasyWorship).
        const labelMatch = slideContent.match(
            /^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending|Refrain|Altar Call)\s*(\d*)\s*$/im,
        )
        const label = labelMatch
            ? labelMatch[1] + (labelMatch[2] ? ` ${labelMatch[2]}` : '')
            : i === 0
                ? 'Verse 1'
                : `Verse ${i + 1}`
        const content = labelMatch
            ? slideContent.replace(labelMatch[0], '').trim()
            : slideContent
        return { label, content }
    })
}

/**
 * Strategy: plain text with blank lines separating sections. Last resort
 * for formats we don't recognize.
 *
 * IMPORTANT: only enter this strategy if the text actually shows the kind
 * of structural separation that suggests verse boundaries. We do NOT want
 * to split lyric text on every blank line, because EasyWorship exports
 * include a typographic blank line between virtually every lyric line —
 * splitting there would create 20+ "verses" of one line each for songs
 * that are really 2-3 verses.
 *
 * Heuristic: if the longest non-blank chunk is much bigger than the
 * median, or if every paragraph has only 1-2 lines, treat the whole
 * thing as one verse. Otherwise split on blank lines.
 */
function extractByBlankLines(parsedText: string): { label: string; content: string }[] {
    const plainText = cleanRTFOutput(parsedText)
    if (!plainText.trim()) return []

    const paragraphs = plainText
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)

    if (paragraphs.length > 1) {
        const lineCounts = paragraphs.map((p) => p.split('\n').length)
        const median = lineCounts.slice().sort((a, b) => a - b)[Math.floor(lineCounts.length / 2)]

        // If the typical "paragraph" is a single lyric line, this is
        // almost certainly EasyWorship's per-line spacing, not real
        // verse separation. Return one verse and let the user split
        // in the UI if they want finer grouping.
        if (median <= 2) {
            return [{ label: '', content: plainText.trim() }]
        }

        return paragraphs.map((content, i) => ({
            label: `Verse ${i + 1}`,
            content,
        }))
    }
    return [{ label: '', content: plainText.trim() }]
}
