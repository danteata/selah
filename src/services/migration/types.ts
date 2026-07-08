/**
 * Migration Types for EasyWorship to Selah
 */

import type { SongSection } from '../../types';

// EasyWorship 6/7 song format from Songs.db
export interface EWSongSQLite {
    rowid?: number;                         // Primary key
    song_item_uid?: string;                 // Unique item identifier
    song_rev_uid?: string;                  // Revision UID
    song_uid?: string;                      // Song UID
    title?: string;                         // Song title
    author?: string;                        // Author/composer
    copyright?: string;                     // Copyright info
    administrator?: string;                 // Administrator
    description?: string;                   // Description
    tags?: string;                          // Tags
    reference_number?: string;              // Reference number (e.g., CCLI)
    provider_id?: number;                   // Provider ID (-1 for local)
    vendor_id?: number;                     // Vendor ID
    presentation_id?: number;               // Presentation ID
    layout_revision?: number;               // Layout revision number
    revision?: number;                      // Revision number
    // Legacy fields that may exist in older versions
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

// EasyWorship words/lyrics from SongWords.db
export interface EWSongWords {
    rowid: number;                          // Primary key
    song_id: number;                        // Foreign key to song.rowid
    words: string;                          // RTF formatted lyrics
    slide_uids?: string;                    // Slide UIDs
    slide_layout_revisions?: number[];      // Layout revisions
    slide_revisions?: number[];             // Slide revisions
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
    // Structured sections + play order for the predictive lyric tracker.
    sections?: SongSection[];
    defaultArrangement?: string[];
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
    sections?: SongSection[];
    defaultArrangement?: string[];
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