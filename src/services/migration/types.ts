/**
 * Migration Types for EasyWorship to Selah
 */

// EasyWorship raw song format from SQLite
export interface EWSongSQLite {
    song_id?: number;
    title: string;
    author?: string;
    lyrics?: string;
    copyright?: string;
    ccli_number?: string;
    ccli?: string;
    alternate_title?: string;
    book_name?: string;
    notes?: string;
    last_used?: string;
    times_used?: number;
    themes?: string;
    keywords?: string;
    publisher?: string;
    release_year?: string;
}

// EasyWorship XML song format
export interface EWSongXML {
    title: string;
    author?: string;
    lyrics?: string;
    copyright?: string;
    ccli?: string;
    alternate_title?: string;
    themes?: string;
}

// Parsed song ready for import
export interface ParsedSong {
    title: string;
    author: string;
    lyrics: string;
    verses: string[];
    copyright?: string;
    ccli?: string;
    alternateTitle?: string;
    themes?: string[];
    raw: EWSongSQLite | EWSongXML; // Original data for reference
    isValid: boolean;
    validationErrors: string[];
}

// Song formatted for Selah import
export interface SelahSongImport {
    title: string;
    artist: string;
    lyrics: string;
    verses: string[];
    author?: string;
    copyright?: string;
    ccli?: string;
}

// Migration status
export type MigrationStatus = 'idle' | 'parsing' | 'preview' | 'importing' | 'complete' | 'error';

// Migration progress
export interface MigrationProgress {
    status: MigrationStatus;
    totalSongs: number;
    parsedSongs: number;
    importedSongs: number;
    failedSongs: number;
    skippedSongs: number;
    currentSong?: string;
    errors: MigrationError[];
    startTime?: Date;
    endTime?: Date;
}

// Migration error
export interface MigrationError {
    songTitle?: string;
    error: string;
    type: 'parse' | 'import' | 'duplicate' | 'validation';
}

// Duplicate check result
export interface DuplicateCheck {
    importTitle: string;
    existingSongId: string;
    existingTitle: string;
    similarity: number; // 0-1 score
}

// File type detection
export type EasyWorshipFileType = 'sqlite' | 'xml' | 'csv' | 'unknown';

// Import result from Convex
export interface ImportResult {
    success: number;
    failed: number;
    errors: string[];
    importedIds: string[];
}

// Batch import progress
export interface BatchImportProgress {
    batchId: string;
    totalBatches: number;
    currentBatch: number;
    songsInBatch: number;
    totalSongs: number;
    importedSoFar: number;
}