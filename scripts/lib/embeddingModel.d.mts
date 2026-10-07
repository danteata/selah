// Types for embeddingModel.mjs, so the app's tests can check the scripts use
// the same model as `src/services/sermon-listener/embeddingModel.ts`.
import type { EMBEDDING_MODEL as APP_MODEL, EmbeddingKind } from '../../src/services/sermon-listener/embeddingModel'

export declare const EMBEDDING_MODEL: typeof APP_MODEL
export declare const EMBEDDING_MODEL_REVISION: string
export declare const EMBEDDING_MODEL_FILES: ReadonlyArray<{ path: string; size: number; sha256: string }>
export declare const GEMMA_NOTICE: string
export declare function loadEmbedder(
    repoRoot: string,
    options?: { log?: (message: string) => void },
): Promise<{ embed: (texts: string[], kind: EmbeddingKind) => Promise<number[][]>; dimensions: number }>
