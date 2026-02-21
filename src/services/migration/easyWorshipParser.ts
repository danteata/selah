/**
 * EasyWorship Song Parser
 * 
 * Parses song data from EasyWorship 6 and 7 exports:
 * - SQLite databases (Songs.db, SongWords.db, SongKeys.db)
 * - XML export files
 * - CSV export files
 * 
 * EasyWorship 6/7 stores data across multiple SQLite databases:
 * - Songs.db: Song metadata (title, author, copyright, etc.)
 * - SongWords.db: Lyrics in RTF format
 * - SongKeys.db: Search keywords
 * - SongHistory.db: Usage history
 */

import type { EWSongSQLite, EWSongWords, ParsedSong, EasyWorshipFileType } from './types';
import { parseVersesRaw, cleanLyrics, isEasyWorshipFormat } from './verseParser';
import { parseRTF, extractVerseStructureFromRTF } from './rtfParser';

// Import sql.js for SQLite parsing (browser-based)
// This is a WebAssembly version of SQLite that works in the browser
let SQL: any = null;

async function initSqlJs() {
    if (SQL) return SQL;

    // Import sql.js
    const initSqlJs = (await import('sql.js')).default;

    // Load WASM from public folder - sql.js looks for sql-wasm-browser.wasm
    SQL = await initSqlJs({
        locateFile: (file: string) => `/${file}`
    });
    return SQL;
}

/**
 * Detect the file type based on file extension and content
 */
export function detectFileType(file: File): EasyWorshipFileType {
    const name = file.name.toLowerCase();

    if (name.endsWith('.db') || name.endsWith('.sqlite') || name.endsWith('.sqlite3')) {
        return 'sqlite';
    }
    if (name.endsWith('.xml')) {
        return 'xml';
    }
    if (name.endsWith('.csv')) {
        return 'csv';
    }

    return 'unknown';
}

/**
 * Parse EasyWorship SQLite database(s)
 * 
 * Can handle:
 * - Single Songs.db file (if lyrics are embedded)
 * - Multiple files: Songs.db + SongWords.db
 * - A zip file containing all EasyWorship data files
 */
export async function parseSQLite(file: File): Promise<ParsedSong[]> {
    try {
        const sql = await initSqlJs();
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const db = new sql.Database(uint8Array);

        // Get all table names
        const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
        const tableNames = tables[0]?.values.map((v: any) => v[0]) || [];

        console.log('SQLite tables found:', tableNames);

        // Determine which database type this is
        const hasSongTable = tableNames.some((t: string) => t.toLowerCase() === 'song');
        const hasWordTable = tableNames.some((t: string) => t.toLowerCase() === 'word');

        if (hasWordTable && !hasSongTable) {
            // This is SongWords.db - contains lyrics only
            console.log('Detected SongWords.db (lyrics database)');
            return parseSongWordsDB(db, tableNames);
        } else if (hasSongTable) {
            // This is Songs.db - contains metadata
            console.log('Detected Songs.db (metadata database)');
            return parseSongsDB(db, tableNames);
        } else {
            throw new Error('Unrecognized database structure. Expected Songs.db or SongWords.db format.');
        }
    } catch (error) {
        console.error('Error parsing SQLite:', error);
        throw new Error(`Failed to parse SQLite database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Parse Songs.db - contains song metadata
 */
async function parseSongsDB(db: any, tableNames: string[]): Promise<ParsedSong[]> {
    // Find the song table
    const songTableName = tableNames.find((t: string) => t.toLowerCase() === 'song') || 'song';

    // Query all songs
    const result = db.exec(`SELECT * FROM "${songTableName}"`);

    if (!result.length || !result[0]) {
        console.log('No results from Songs.db query');
        return [];
    }

    const queryResult = result[0];
    const columns: string[] = (queryResult as any).lc || queryResult.columns || [];
    const rows: any[][] = queryResult.values || [];

    if (!rows.length) {
        console.log('No rows in Songs.db');
        return [];
    }

    console.log(`Found ${rows.length} songs in Songs.db`);

    // Map column names to lowercase for easier lookup
    const colIndex: Record<string, number> = {};
    columns.forEach((col, i) => {
        colIndex[col.toLowerCase()] = i;
    });

    // Parse each row into ParsedSong
    const songs: ParsedSong[] = rows.map(row => {
        const rawSong: EWSongSQLite = {
            rowid: row[colIndex['rowid']] ?? row[colIndex['id']],
            song_item_uid: row[colIndex['song_item_uid']],
            song_rev_uid: row[colIndex['song_rev_uid']],
            song_uid: row[colIndex['song_uid']],
            title: row[colIndex['title']] ?? '',
            author: row[colIndex['author']] ?? '',
            copyright: row[colIndex['copyright']],
            administrator: row[colIndex['administrator']],
            description: row[colIndex['description']],
            tags: row[colIndex['tags']],
            reference_number: row[colIndex['reference_number']],
            provider_id: row[colIndex['provider_id']],
            vendor_id: row[colIndex['vendor_id']],
            presentation_id: row[colIndex['presentation_id']],
            layout_revision: row[colIndex['layout_revision']],
            revision: row[colIndex['revision']],
        };

        return parseRawSongFromMetadata(rawSong);
    });

    db.close();
    return songs;
}

/**
 * Parse SongWords.db - contains lyrics in RTF format
 */
async function parseSongWordsDB(db: any, tableNames: string[]): Promise<ParsedSong[]> {
    // Find the word table
    const wordTableName = tableNames.find((t: string) => t.toLowerCase() === 'word') || 'word';

    // Query all lyrics
    const result = db.exec(`SELECT * FROM "${wordTableName}"`);

    if (!result.length || !result[0]) {
        console.log('No results from SongWords.db query');
        return [];
    }

    const queryResult = result[0];
    const columns: string[] = (queryResult as any).lc || queryResult.columns || [];
    const rows: any[][] = queryResult.values || [];

    if (!rows.length) {
        console.log('No rows in SongWords.db');
        return [];
    }

    console.log(`Found ${rows.length} lyrics entries in SongWords.db`);

    // Map column names to lowercase for easier lookup
    const colIndex: Record<string, number> = {};
    columns.forEach((col, i) => {
        colIndex[col.toLowerCase()] = i;
    });

    // Parse each row into ParsedSong (lyrics only, no metadata)
    const songs: ParsedSong[] = rows.map(row => {
        const songId = row[colIndex['song_id']];
        const rtfLyrics = row[colIndex['words']] ?? '';

        // Parse RTF to plain text
        const plainLyrics = parseRTF(rtfLyrics);

        // Extract verse structure
        const verseStructure = extractVerseStructureFromRTF(rtfLyrics);
        const verses = verseStructure
            .filter(v => v.content.trim())
            .map(v => v.content);

        return {
            title: `Song ${songId}`, // Will be matched with Songs.db
            author: 'Unknown',
            lyrics: plainLyrics,
            verses: verses.length > 0 ? verses : (plainLyrics ? [plainLyrics] : []),
            raw: { rowid: songId, words: rtfLyrics } as any,
            isValid: plainLyrics.trim().length > 0,
            validationErrors: plainLyrics.trim() ? [] : ['Missing lyrics'],
            _songId: songId, // For matching with metadata
        } as ParsedSong & { _songId: number };
    });

    db.close();
    return songs;
}

/**
 * Parse multiple EasyWorship database files and merge them
 * 
 * @param files - Object containing File objects for each database
 */
export async function parseEasyWorshipDatabases(files: {
    songsDb?: File;
    songWordsDb?: File;
    songKeysDb?: File;
}): Promise<ParsedSong[]> {
    const sql = await initSqlJs();

    // Parse metadata from Songs.db
    let songsMetadata: Map<number, EWSongSQLite> = new Map();
    if (files.songsDb) {
        const arrayBuffer = await files.songsDb.arrayBuffer();
        const db = new sql.Database(new Uint8Array(arrayBuffer));

        const result = db.exec('SELECT * FROM song');
        if (result.length && result[0]) {
            const columns: string[] = (result[0] as any).lc || result[0].columns || [];
            const rows: any[][] = result[0].values || [];

            const colIndex: Record<string, number> = {};
            columns.forEach((col, i) => {
                colIndex[col.toLowerCase()] = i;
            });

            for (const row of rows) {
                const songId = row[colIndex['rowid']];
                const metadata: EWSongSQLite = {
                    rowid: songId,
                    song_item_uid: row[colIndex['song_item_uid']],
                    song_rev_uid: row[colIndex['song_rev_uid']],
                    song_uid: row[colIndex['song_uid']],
                    title: row[colIndex['title']] ?? '',
                    author: row[colIndex['author']] ?? '',
                    copyright: row[colIndex['copyright']],
                    administrator: row[colIndex['administrator']],
                    description: row[colIndex['description']],
                    tags: row[colIndex['tags']],
                    reference_number: row[colIndex['reference_number']],
                    provider_id: row[colIndex['provider_id']],
                    vendor_id: row[colIndex['vendor_id']],
                    presentation_id: row[colIndex['presentation_id']],
                    layout_revision: row[colIndex['layout_revision']],
                    revision: row[colIndex['revision']],
                };
                songsMetadata.set(songId, metadata);
            }
        }
        db.close();
    }

    // Parse lyrics from SongWords.db
    let songsWithLyrics: ParsedSong[] = [];
    if (files.songWordsDb) {
        const arrayBuffer = await files.songWordsDb.arrayBuffer();
        const db = new sql.Database(new Uint8Array(arrayBuffer));

        const result = db.exec('SELECT * FROM word');
        if (result.length && result[0]) {
            const columns: string[] = (result[0] as any).lc || result[0].columns || [];
            const rows: any[][] = result[0].values || [];

            const colIndex: Record<string, number> = {};
            columns.forEach((col, i) => {
                colIndex[col.toLowerCase()] = i;
            });

            for (const row of rows) {
                const songId = row[colIndex['song_id']];
                const rtfLyrics = row[colIndex['words']] ?? '';

                // Get metadata if available
                const metadata = songsMetadata.get(songId);

                // Parse RTF to plain text
                const plainLyrics = parseRTF(rtfLyrics);

                // Extract verse structure
                const verseStructure = extractVerseStructureFromRTF(rtfLyrics);
                const verses = verseStructure
                    .filter(v => v.content.trim())
                    .map(v => v.content);

                const song: ParsedSong = {
                    title: metadata?.title ?? `Song ${songId}`,
                    author: metadata?.author ?? 'Unknown',
                    lyrics: plainLyrics,
                    verses: verses.length > 0 ? verses : (plainLyrics ? [plainLyrics] : []),
                    copyright: metadata?.copyright,
                    ccli: metadata?.reference_number,
                    themes: metadata?.tags?.split(/[;,]/).map(t => t.trim()).filter(Boolean),
                    raw: metadata || { rowid: songId },
                    isValid: !!(metadata?.title && plainLyrics.trim()),
                    validationErrors: [
                        ...(metadata?.title ? [] : ['Missing title']),
                        ...(plainLyrics.trim() ? [] : ['Missing lyrics']),
                    ],
                };

                songsWithLyrics.push(song);
            }
        }
        db.close();
    }

    // If we only have Songs.db (no SongWords.db), create songs from metadata only
    if (songsMetadata.size > 0 && songsWithLyrics.length === 0) {
        for (const [_, metadata] of songsMetadata) {
            songsWithLyrics.push(parseRawSongFromMetadata(metadata));
        }
    }

    return songsWithLyrics;
}

/**
 * Parse a raw song metadata into ParsedSong format
 */
function parseRawSongFromMetadata(raw: EWSongSQLite): ParsedSong {
    const validationErrors: string[] = [];

    // Extract and clean title
    const title = (raw.title || '').trim();
    if (!title) {
        validationErrors.push('Missing title');
    }

    // Extract and clean author/artist
    const author = (raw.author || 'Unknown').trim();

    // Note: Lyrics are not in Songs.db, they're in SongWords.db
    // This is a placeholder for when we only have metadata
    const lyrics = '';
    const verses: string[] = [];

    // Extract themes from tags
    const themes = raw.tags
        ? raw.tags.split(/[;,]/).map(t => t.trim()).filter(Boolean)
        : [];

    return {
        title,
        author,
        lyrics,
        verses,
        copyright: raw.copyright || undefined,
        ccli: raw.reference_number || undefined,
        themes: themes.length > 0 ? themes : undefined,
        raw,
        isValid: validationErrors.length === 0,
        validationErrors,
    };
}

/**
 * Parse EasyWorship XML export
 */
export async function parseXML(file: File): Promise<ParsedSong[]> {
    try {
        const text = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');

        // Check for parse errors
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            throw new Error('Invalid XML format');
        }

        // Find all song elements
        // EW XML format can vary, try common structures
        let songElements = doc.querySelectorAll('song, Song, SONG');

        if (!songElements.length) {
            // Try alternative format with root container
            songElements = doc.querySelectorAll('songs > song, Songs > Song, SONGS > SONG');
        }

        if (!songElements.length) {
            throw new Error('No songs found in XML file');
        }

        const songs: ParsedSong[] = [];

        songElements.forEach(songEl => {
            const title = getElementText(songEl, 'title, Title, TITLE');
            const author = getElementText(songEl, 'author, Author, AUTHOR, authors, Authors');
            const lyricsRaw = getElementText(songEl, 'lyrics, Lyrics, LYRICS, words, Words');
            const copyright = getElementText(songEl, 'copyright, Copyright, COPYRIGHT');
            const ccli = getElementText(songEl, 'ccli, CCLI, ccli_number');

            // Check if lyrics are RTF
            let lyrics = lyricsRaw;
            let verses: string[] = [];

            if (lyricsRaw.startsWith('{\\rtf')) {
                // Parse RTF
                lyrics = parseRTF(lyricsRaw);
                const verseStructure = extractVerseStructureFromRTF(lyricsRaw);
                verses = verseStructure
                    .filter(v => v.content.trim())
                    .map(v => v.content);
            } else if (lyrics) {
                // Plain text - check for verse markers
                lyrics = cleanLyrics(lyrics);
                if (isEasyWorshipFormat(lyrics)) {
                    verses = parseVersesRaw(lyrics);
                } else {
                    verses = [lyrics];
                }
            }

            const validationErrors: string[] = [];
            if (!title) validationErrors.push('Missing title');
            if (!lyrics) validationErrors.push('Missing lyrics');

            songs.push({
                title: title || 'Untitled',
                author: author || 'Unknown',
                lyrics,
                verses: verses.length > 0 ? verses : (lyrics ? [lyrics] : []),
                copyright: copyright || undefined,
                ccli: ccli || undefined,
                raw: { title, author, lyrics: lyricsRaw, copyright, ccli },
                isValid: validationErrors.length === 0,
                validationErrors,
            });
        });

        return songs;
    } catch (error) {
        console.error('Error parsing XML:', error);
        throw new Error(`Failed to parse XML file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Parse EasyWorship CSV export
 */
export async function parseCSV(file: File): Promise<ParsedSong[]> {
    try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);

        if (lines.length < 2) {
            throw new Error('CSV file is empty or has no data rows');
        }

        // Parse header
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

        // Find column indices
        const colIndex: Record<string, number> = {};
        headers.forEach((header, i) => {
            colIndex[header] = i;
            // Also map common variations
            if (header.includes('title')) colIndex['title'] = i;
            if (header.includes('author')) colIndex['author'] = i;
            if (header.includes('lyric') || header.includes('word')) colIndex['lyrics'] = i;
        });

        const songs: ParsedSong[] = [];

        // Parse data rows
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = parseCSVLine(line);

            const title = values[colIndex['title']] ?? '';
            const author = values[colIndex['author']] ?? values[colIndex['authors']] ?? 'Unknown';
            let lyricsRaw = values[colIndex['lyrics']] ?? values[colIndex['words']] ?? '';
            const copyright = values[colIndex['copyright']];
            const ccli = values[colIndex['ccli_number']] ?? values[colIndex['ccli']];

            // Check if lyrics are RTF
            let lyrics = lyricsRaw;
            let verses: string[] = [];

            if (lyricsRaw.startsWith('{\\rtf')) {
                lyrics = parseRTF(lyricsRaw);
                const verseStructure = extractVerseStructureFromRTF(lyricsRaw);
                verses = verseStructure
                    .filter(v => v.content.trim())
                    .map(v => v.content);
            } else if (lyricsRaw) {
                lyrics = cleanLyrics(lyricsRaw);
                if (isEasyWorshipFormat(lyrics)) {
                    verses = parseVersesRaw(lyrics);
                } else {
                    verses = [lyrics];
                }
            }

            const validationErrors: string[] = [];
            if (!title) validationErrors.push('Missing title');
            if (!lyrics) validationErrors.push('Missing lyrics');

            songs.push({
                title: title || 'Untitled',
                author,
                lyrics,
                verses: verses.length > 0 ? verses : (lyrics ? [lyrics] : []),
                copyright,
                ccli,
                raw: { title, author, lyrics: lyricsRaw, copyright, ccli_number: ccli },
                isValid: validationErrors.length === 0,
                validationErrors,
            });
        }

        return songs;
    } catch (error) {
        console.error('Error parsing CSV:', error);
        throw new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Helper to get text content from element using CSS selectors
 */
function getElementText(parent: Element, selectors: string): string {
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const selector of selectorList) {
        const el = parent.querySelector(selector);
        if (el && el.textContent) {
            return el.textContent.trim();
        }
    }
    return '';
}

/**
 * Parse a CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Escaped quote
                current += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Add last field
    values.push(current.trim());

    return values;
}

/**
 * Main parser function - detects file type and parses accordingly
 */
export async function parseEasyWorshipFile(file: File): Promise<{
    songs: ParsedSong[];
    fileType: EasyWorshipFileType;
    errors: string[];
}> {
    const fileType = detectFileType(file);
    const errors: string[] = [];
    let songs: ParsedSong[] = [];

    switch (fileType) {
        case 'sqlite':
            songs = await parseSQLite(file);
            break;
        case 'xml':
            songs = await parseXML(file);
            break;
        case 'csv':
            songs = await parseCSV(file);
            break;
        default:
            errors.push(`Unsupported file type: ${file.name}`);
    }

    // Filter out invalid songs but keep them for review
    const invalidCount = songs.filter(s => !s.isValid).length;
    if (invalidCount > 0) {
        errors.push(`${invalidCount} song(s) have missing data and may need review`);
    }

    return { songs, fileType, errors };
}

/**
 * Convert ParsedSong to SelahSongImport format
 */
export function toSelahSong(song: ParsedSong): SelahSongImport {
    return {
        title: song.title,
        artist: song.author,
        lyrics: song.lyrics,
        verses: song.verses,
        author: song.author,
        copyright: song.copyright,
        ccli: song.ccli,
    };
}

// Import the type for SelahSongImport
import type { SelahSongImport } from './types';
