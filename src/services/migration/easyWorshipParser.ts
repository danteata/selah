/**
 * EasyWorship Song Parser
 * 
 * Parses song data from EasyWorship 6 and 7 exports:
 * - SQLite database (Songs.db)
 * - XML export files
 * - CSV export files
 */

import type { EWSongSQLite, EWSongXML, ParsedSong, EasyWorshipFileType } from './types';
import { parseVersesRaw, cleanLyrics, isEasyWorshipFormat } from './verseParser';

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
 * Parse EasyWorship SQLite database (Songs.db)
 * Works with both EW6 and EW7 formats
 */
export async function parseSQLite(file: File): Promise<ParsedSong[]> {
    try {
        const sql = await initSqlJs();
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const db = new sql.Database(uint8Array);

        // Try to find the songs table
        // EW6: usually "Song" table
        // EW7: usually "songs" or "Song" table
        let tableName = 'Song';

        // Check if table exists
        const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
        const tableNames = tables[0]?.values.map((v: any) => v[0]) || [];

        if (tableNames.includes('songs')) {
            tableName = 'songs';
        } else if (tableNames.includes('Song')) {
            tableName = 'Song';
        } else {
            // Try to find any table with 'song' in the name
            const songTable = tableNames.find((n: string) => n.toLowerCase().includes('song'));
            if (songTable) {
                tableName = songTable;
            } else {
                throw new Error('No songs table found in database');
            }
        }

        // Query all songs
        const result = db.exec(`SELECT * FROM "${tableName}"`);

        console.log('Full SQLite result:', JSON.stringify(result, null, 2));

        if (!result.length || !result[0]) {
            console.log('No results from query');
            return [];
        }

        const queryResult = result[0];

        // sql.js returns { lc: [], values: [[]] } - lc contains lowercase column names
        const columns: string[] = (queryResult as any).lc || queryResult.columns || [];
        const rows: any[][] = queryResult.values || [];

        if (!rows.length) {
            console.log('No rows in result');
            return [];
        }

        console.log('SQLite query result:', { tableName, columns, rowCount: rows.length });

        // Map column names to lowercase for easier lookup
        const colIndex: Record<string, number> = {};
        columns.forEach((col, i) => {
            colIndex[col.toLowerCase()] = i;
        });

        // Parse each row into ParsedSong
        const songs: ParsedSong[] = rows.map(row => {
            const rawSong: EWSongSQLite = {
                song_id: row[colIndex['song_id']] ?? row[colIndex['id']],
                title: row[colIndex['title']] ?? '',
                author: row[colIndex['author']] ?? row[colIndex['authors']],
                lyrics: row[colIndex['lyrics']] ?? row[colIndex['words']] ?? '',
                copyright: row[colIndex['copyright']],
                ccli_number: row[colIndex['ccli_number']] ?? row[colIndex['cclinumber']],
                ccli: row[colIndex['ccli']],
                alternate_title: row[colIndex['alternate_title']] ?? row[colIndex['alternatetitle']],
                book_name: row[colIndex['book_name']],
                notes: row[colIndex['notes']],
                themes: row[colIndex['themes']] ?? row[colIndex['theme']],
                keywords: row[colIndex['keywords']],
                publisher: row[colIndex['publisher']],
                release_year: row[colIndex['release_year']],
            };

            return parseRawSong(rawSong);
        });

        db.close();
        return songs;
    } catch (error) {
        console.error('Error parsing SQLite:', error);
        throw new Error(`Failed to parse SQLite database: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
        const songElements = doc.querySelectorAll('song, Song, SONG');

        if (!songElements.length) {
            // Try alternative format with root container
            const rootSongs = doc.querySelectorAll('songs > song, Songs > Song, SONGS > SONG');
            if (!rootSongs.length) {
                throw new Error('No songs found in XML file');
            }
        }

        const songs: ParsedSong[] = [];

        songElements.forEach(songEl => {
            const rawSong: EWSongXML = {
                title: getElementText(songEl, 'title, Title, TITLE'),
                author: getElementText(songEl, 'author, Author, AUTHOR, authors, Authors'),
                lyrics: getElementText(songEl, 'lyrics, Lyrics, LYRICS, words, Words'),
                copyright: getElementText(songEl, 'copyright, Copyright, COPYRIGHT'),
                ccli: getElementText(songEl, 'ccli, CCLI, ccli_number'),
                alternate_title: getElementText(songEl, 'alternate_title, alternateTitle'),
                themes: getElementText(songEl, 'themes, Themes, theme, Theme'),
            };

            songs.push(parseRawSong(rawSong));
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

            const rawSong: EWSongSQLite = {
                title: values[colIndex['title']] ?? '',
                author: values[colIndex['author']] ?? values[colIndex['authors']],
                lyrics: values[colIndex['lyrics']] ?? values[colIndex['words']] ?? '',
                copyright: values[colIndex['copyright']],
                ccli_number: values[colIndex['ccli_number']] ?? values[colIndex['ccli']],
                alternate_title: values[colIndex['alternate_title']],
            };

            songs.push(parseRawSong(rawSong));
        }

        return songs;
    } catch (error) {
        console.error('Error parsing CSV:', error);
        throw new Error(`Failed to parse CSV file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

/**
 * Parse a raw song into ParsedSong format
 */
function parseRawSong(raw: EWSongSQLite | EWSongXML): ParsedSong {
    const validationErrors: string[] = [];

    // Extract and clean title
    const title = (raw.title || '').trim();
    if (!title) {
        validationErrors.push('Missing title');
    }

    // Extract and clean author/artist
    const author = (raw.author || 'Unknown').trim();

    // Extract and clean lyrics
    let lyrics = cleanLyrics(raw.lyrics || '');
    if (!lyrics) {
        validationErrors.push('Missing lyrics');
        lyrics = '';
    }

    // Parse verses
    let verses: string[] = [];
    if (lyrics) {
        if (isEasyWorshipFormat(lyrics)) {
            verses = parseVersesRaw(lyrics);
        } else {
            // Plain text - treat as single verse
            verses = [lyrics];
        }
    }

    // Extract CCLI (check both field names)
    const ccli = raw.ccli || (raw as EWSongSQLite).ccli_number || '';

    // Extract themes
    const themesRaw = (raw as EWSongSQLite).themes || '';
    const themes = themesRaw
        ? themesRaw.split(/[;,]/).map(t => t.trim()).filter(Boolean)
        : [];

    return {
        title,
        author,
        lyrics,
        verses,
        copyright: raw.copyright || undefined,
        ccli: ccli || undefined,
        alternateTitle: (raw as EWSongSQLite).alternate_title || undefined,
        themes: themes.length > 0 ? themes : undefined,
        raw,
        isValid: validationErrors.length === 0,
        validationErrors,
    };
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