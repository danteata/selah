/**
 * Verse Parser for EasyWorship Song Format
 * 
 * EasyWorship uses verse markers like [V1], [C], [B] to denote song sections.
 * This parser converts them to Selah's verse array format.
 */

// EasyWorship verse markers
const VERSE_MARKERS = {
    'V': 'Verse',
    'C': 'Chorus',
    'B': 'Bridge',
    'P': 'Pre-Chorus',
    'T': 'Tag',
    'E': 'Ending',
    'I': 'Intro',
    'O': 'Outro',
    'A': 'Altar Call',
    'R': 'Refrain',
} as const;

// Regex pattern to match verse markers: [V1], [C], [B2], etc.
const VERSE_MARKER_REGEX = /\[([VCPBTEIOAR])(\d*)\s*([^\]]*)\]/gi;

/**
 * Parse EasyWorship lyrics into verse blocks
 * 
 * Example input:
 * [V1] Amazing grace how sweet the sound
 * That saved a wretch like me
 * [C] Praise God from whom all blessings flow
 * [V2] 'Twas grace that taught my heart to fear
 * 
 * Output:
 * [
 *   "Verse 1:\nAmazing grace how sweet the sound\nThat saved a wretch like me",
 *   "Chorus:\nPraise God from whom all blessings flow",
 *   "Verse 2:\n'Twas grace that taught my heart to fear"
 * ]
 */
export function parseVerseMarkers(lyrics: string): string[] {
    if (!lyrics || typeof lyrics !== 'string') {
        return [];
    }

    // Normalize line endings
    const normalized = lyrics.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into sections by verse markers
    const sections: { marker: string; label: string; content: string }[] = [];

    // Find all verse markers and their positions
    const markers: { index: number; marker: string; label: string }[] = [];
    let match;

    while ((match = VERSE_MARKER_REGEX.exec(normalized)) !== null) {
        const [fullMatch, type, number, label] = match;
        const markerType = VERSE_MARKERS[type as keyof typeof VERSE_MARKERS] || type;
        const markerLabel = label ? label.trim() : `${markerType}${number || ''}`;

        markers.push({
            index: match.index,
            marker: fullMatch,
            label: markerLabel,
        });
    }

    // If no markers found, return the whole lyrics as single verse
    if (markers.length === 0) {
        const trimmed = normalized.trim();
        if (trimmed) {
            return [trimmed];
        }
        return [];
    }

    // Extract content between markers
    for (let i = 0; i < markers.length; i++) {
        const startIdx = markers[i].index + markers[i].marker.length;
        const endIdx = i < markers.length - 1 ? markers[i + 1].index : normalized.length;
        const content = normalized.slice(startIdx, endIdx).trim();

        if (content) {
            sections.push({
                marker: markers[i].marker,
                label: markers[i].label,
                content,
            });
        }
    }

    // Format as verse blocks
    return sections.map(section => {
        const content = section.content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .join('\n');

        return `${section.label}:\n${content}`;
    });
}

/**
 * Parse lyrics and return raw verse content without labels
 * Used for storing in the verses array
 */
export function parseVersesRaw(lyrics: string): string[] {
    if (!lyrics || typeof lyrics !== 'string') {
        return [];
    }

    // Normalize line endings
    const normalized = lyrics.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into sections by verse markers
    const verses: string[] = [];

    // Find all verse markers and their positions
    const markers: { index: number; length: number }[] = [];
    let match;

    VERSE_MARKER_REGEX.lastIndex = 0;
    while ((match = VERSE_MARKER_REGEX.exec(normalized)) !== null) {
        markers.push({
            index: match.index,
            length: match[0].length,
        });
    }

    // If no markers found, return the whole lyrics as single verse
    if (markers.length === 0) {
        const trimmed = normalized.trim();
        if (trimmed) {
            return [trimmed];
        }
        return [];
    }

    // Extract content between markers
    for (let i = 0; i < markers.length; i++) {
        const startIdx = markers[i].index + markers[i].length;
        const endIdx = i < markers.length - 1 ? markers[i + 1].index : normalized.length;
        const content = normalized.slice(startIdx, endIdx)
            .trim()
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .join('\n');

        if (content) {
            verses.push(content);
        }
    }

    return verses;
}

/**
 * Convert verse array back to EasyWorship format
 */
export function versesToEWFormat(verses: string[]): string {
    return verses.map((verse, index) => {
        const marker = index === 0 ? '[V1]' : `[V${index + 1}]`;
        return `${marker}\n${verse}`;
    }).join('\n\n');
}

/**
 * Clean up lyrics by removing excessive whitespace and normalizing format
 */
export function cleanLyrics(lyrics: string): string {
    if (!lyrics || typeof lyrics !== 'string') {
        return '';
    }

    return lyrics
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Count verses in lyrics
 */
export function countVerses(lyrics: string): number {
    if (!lyrics) return 0;

    VERSE_MARKER_REGEX.lastIndex = 0;
    const matches = lyrics.match(VERSE_MARKER_REGEX);
    return matches ? matches.length : 1;
}

/**
 * Detect if lyrics use EasyWorship format
 */
export function isEasyWorshipFormat(lyrics: string): boolean {
    if (!lyrics) return false;
    VERSE_MARKER_REGEX.lastIndex = 0;
    return VERSE_MARKER_REGEX.test(lyrics);
}

/**
 * Extract verse structure info for display
 */
export function getVerseStructure(lyrics: string): { type: string; number: string; content: string }[] {
    if (!lyrics) return [];

    const normalized = lyrics.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const structure: { type: string; number: string; content: string }[] = [];

    const markers: { index: number; type: string; number: string }[] = [];
    let match;

    VERSE_MARKER_REGEX.lastIndex = 0;
    while ((match = VERSE_MARKER_REGEX.exec(normalized)) !== null) {
        markers.push({
            index: match.index,
            type: match[1],
            number: match[2] || '1',
        });
    }

    for (let i = 0; i < markers.length; i++) {
        const startIdx = markers[i].index;
        const endIdx = i < markers.length - 1 ? markers[i + 1].index : normalized.length;
        // Get content after the marker tag
        const markerEndIdx = normalized.indexOf(']', startIdx) + 1;
        const content = normalized.slice(markerEndIdx, endIdx).trim();

        structure.push({
            type: VERSE_MARKERS[markers[i].type as keyof typeof VERSE_MARKERS] || markers[i].type,
            number: markers[i].number,
            content: content.slice(0, 50) + (content.length > 50 ? '...' : ''),
        });
    }

    return structure;
}