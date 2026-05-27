/**
 * Desktop Summarization Service
 *
 * Provides text summarization via the whisper server sidecar.
 * Two modes:
 * 1. Abstractive (/summarize-abstractive) — paraphrases using distilbart-cnn-6-6
 *    Lazy-loaded on first request (~330MB). Returns real paraphrased summaries.
 * 2. Extractive (/summarize) — picks top sentences using TextRank.
 *    Available immediately if sumy is installed.
 *
 * Returns null gracefully if endpoints aren't available.
 */

import { isDesktop } from '@/platform';

const DESKTOP_WHISPER_PORT = 17493;
const DESKTOP_WHISPER_URL = `http://127.0.0.1:${DESKTOP_WHISPER_PORT}`;

const SUMMARIZE_TIMEOUT_MS = 30000;
const ABSTRACTIVE_TIMEOUT_MS = 60000;

export interface SummarizationRequest {
  text: string;
  sentence_count?: number;
  max_length?: number;
  min_length?: number;
}

export interface SummarizationResult {
  summary: string;
  method?: 'abstractive' | 'extractive';
}

export interface SummarizationStatus {
  available: boolean;
  loaded: boolean;
  abstractiveAvailable?: boolean;
}

let cachedStatus: SummarizationStatus | null = null

/**
 * Check which summarization methods are available on the desktop server.
 *
 * Uses /health which always includes summarization capability fields.
 * Caches the result so we don't repeatedly hit missing endpoints on old binaries.
 */
export async function checkSummarizationStatus(): Promise<SummarizationStatus> {
  if (!isDesktop()) {
    return { available: false, loaded: false };
  }

  if (cachedStatus) return cachedStatus

  try {
    const healthResp = await fetch(`${DESKTOP_WHISPER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });

    if (!healthResp.ok) {
      cachedStatus = { available: false, loaded: false }
      return cachedStatus
    }

    const data = await healthResp.json();

    cachedStatus = {
      available: data.summarization_available ?? false,
      loaded: data.summarizer_loaded ?? data.abstractive_loaded ?? false,
      abstractiveAvailable: data.abstractive_available ?? false,
    };
    return cachedStatus
  } catch {
    cachedStatus = { available: false, loaded: false }
    return cachedStatus
  }
}

/**
 * Summarize text using abstractive model (distilbart-cnn-6-6).
 *
 * Produces a paraphrased summary that doesn't just pick existing sentences.
 * Returns null if not available (older server, no transformers library, etc.).
 */
export async function summarizeAbstractiveWithDesktop(
  request: SummarizationRequest
): Promise<SummarizationResult | null> {
  if (!isDesktop()) {
    return null;
  }

  try {
    const response = await fetch(`${DESKTOP_WHISPER_URL}/summarize-abstractive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        max_length: request.max_length ?? 150,
        min_length: request.min_length ?? 30,
      }),
      signal: AbortSignal.timeout(ABSTRACTIVE_TIMEOUT_MS),
    });

    // 404 = endpoint not deployed, 501 = transformers not installed
    if (response.status === 404 || response.status === 501) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    if (!result.summary) {
      return null;
    }

    return {
      summary: result.summary,
      method: 'abstractive',
    };
  } catch {
    return null;
  }
}

/**
 * Summarize text using the desktop server's extractive summarization endpoint.
 *
 * Returns null if not in desktop mode, endpoint not deployed (404),
 * or if summarization fails. The caller should fall back to web-based extraction.
 */
export async function summarizeWithDesktop(
  request: SummarizationRequest
): Promise<SummarizationResult | null> {
  if (!isDesktop()) {
    return null;
  }

  try {
    const response = await fetch(`${DESKTOP_WHISPER_URL}/summarize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        sentence_count: request.sentence_count ?? 8,
      }),
      signal: AbortSignal.timeout(SUMMARIZE_TIMEOUT_MS),
    });

    // 404 = endpoint not deployed yet — return null gracefully, don't log
    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    return { summary: result.summary, method: 'extractive' };
  } catch {
    // Network error (CORS, server down, etc.) — return null gracefully
    return null;
  }
}