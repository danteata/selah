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

    while (i < len) {
        const char = rtf[i];

        if (char === '{') {
            groupDepth++;
            // Check if we should skip this group due to \* marker
            if (skipNextGroup && skipDepth === -1) {
                skipDepth = groupDepth;
            }
            skipNextGroup = false;
            i++;
        } else if (char === '}') {
            if (skipDepth === groupDepth) {
                // End of skipped destination
                skipDepth = -1;
            }
            groupDepth--;
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
            // Check if we should skip this destination
            else if (parsed.isDestination && skipDepth === -1) {
                skipDepth = groupDepth;
            } else if (skipDepth === -1) {
                // Not skipping - process the control word
                if (parsed.text === 'par' || parsed.text === 'line') {
                    result += '\n';
                } else if (parsed.text === 'tab') {
                    result += '\t';
                } else if (parsed.char) {
                    result += parsed.char;
                }
            }
        } else if (char === '\n' || char === '\r') {
            // Skip newlines in RTF source
            i++;
        } else if (skipDepth === -1 && isPrintable(char)) {
            // Regular text character (not in skipped destination)
            result += char;
            i++;
        } else {
            i++;
        }
    }

    // Clean up the result
    return cleanRTFOutput(result);
}

/**
 * Parse an RTF control word starting at the given index
 */
function parseControlWord(
    rtf: string,
    startIndex: number
): { text: string; newIndex: number; char: string; isDestination: boolean } {
    let i = startIndex + 1; // Skip the backslash
    const len = rtf.length;

    if (i >= len) {
        return { text: '', newIndex: i, char: '', isDestination: false };
    }

    const char = rtf[i];

    // Escaped special characters: \\, \{, \}
    if (char === '\\' || char === '{' || char === '}') {
        return { text: '', newIndex: i + 1, char: char, isDestination: false };
    }

    // \* is a destination marker (skip if unrecognized)
    if (char === '*') {
        return { text: '*', newIndex: i + 1, char: '', isDestination: false };
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
                    isDestination: false
                };
            }
        }
        return { text: '', newIndex: i, char: '', isDestination: false };
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
                    isDestination: false
                };
            }
        }
        return { text: '', newIndex: i, char: '', isDestination: false };
    }

    // Read control word name
    let word = '';
    while (i < len && isLetter(rtf[i])) {
        word += rtf[i];
        i++;
    }

    // Read optional numeric parameter
    if (i < len && (rtf[i] === '-' || isDigit(rtf[i]))) {
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

    return { text: word, newIndex: i, char: '', isDestination };
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

/**
 * Clean up the parsed RTF output
 */
function cleanRTFOutput(text: string): string {
    return text
        // Remove multiple consecutive spaces
        .replace(/ {2,}/g, ' ')
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
    return code >= 32 && code < 127; // Basic printable ASCII
}

/**
 * Extract verse structure from RTF lyrics
 * EasyWorship uses labels like "Verse 1", "Chorus", etc. in the text
 */
export function extractVerseStructureFromRTF(rtfText: string): {
    label: string;
    content: string;
}[] {
    const plainText = parseRTF(rtfText);

    // Pattern to match verse labels in EasyWorship RTF
    // Examples: "Verse 1", "Chorus 1", "Chorus", "Bridge", "Tag", etc.
    const versePattern = /^(Verse|Chorus|Bridge|Tag|Pre-Chorus|Intro|Outro|Ending|Refrain|Altar Call)\s*(\d*)\s*$/im;

    const lines = plainText.split('\n');
    const verses: { label: string; content: string }[] = [];
    let currentLabel = '';
    let currentContent: string[] = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        const match = trimmedLine.match(versePattern);

        if (match) {
            // Found a verse label
            if (currentContent.length > 0 || currentLabel) {
                verses.push({
                    label: currentLabel,
                    content: currentContent.join('\n').trim()
                });
            }
            // Start new verse
            currentLabel = match[1] + (match[2] ? ` ${match[2]}` : '');
            currentContent = [];
        } else if (trimmedLine) {
            // Add to current verse content
            currentContent.push(trimmedLine);
        }
    }

    // Don't forget the last verse
    if (currentContent.length > 0 || currentLabel) {
        verses.push({
            label: currentLabel,
            content: currentContent.join('\n').trim()
        });
    }

    // If no verse structure found, return the whole text as one verse
    if (verses.length === 0 && plainText.trim()) {
        return [{ label: '', content: plainText.trim() }];
    }

    return verses;
}
