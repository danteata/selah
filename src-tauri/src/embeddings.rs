//! Text embeddings for semantic verse search, run natively.
//!
//! The desktop app embeds with EmbeddingGemma 300M (8-bit ONNX). It used to run
//! in the webview through Transformers.js. On macOS that grew the WebKit
//! content process by tens of megabytes per batch, in WebKit's own allocator,
//! until WebKit killed the page at its 8 GB limit and the window went black.
//! Native ONNX Runtime has no such limit and holds a steady footprint.
//!
//! The frontend owns everything model-specific except the arithmetic: it adds
//! the task prefix ("task: search result | query: ", ...) before sending text,
//! and it decides which verse pack to score against (see
//! `src/services/sermon-listener/embeddingModel.ts`). This module tokenizes,
//! runs the graph and returns its `sentence_embedding` output, which the graph
//! has already mean-pooled, projected and L2-normalised.
//!
//! The model loads on first use and stays loaded until `embeddings_unload`
//! (the frontend unloads it after a long idle).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ort::ep;
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::Tensor;
use tauri::{AppHandle, Manager};
use tokenizers::Tokenizer;
use tracing::info;

/// Where the downloader puts the model, relative to the resource dir.
const MODEL_DIR: &str = "assets/embedding-models/onnx-community/embeddinggemma-300m-ONNX";
/// `onnx/model_quantized.onnx` rewritten to gather token embeddings before
/// dequantizing them; the stock graph expands the whole 262144 × 768 table to
/// float32 (805 MB) on every call. Same weights, bit-identical output. Built by
/// `scripts/embedding-graph/gather_first.py`, installed by the downloader.
const MODEL_FILE: &str = "onnx/model_quantized_gather_first.onnx";
/// The graph as published, which the verse pack was built with.
#[cfg(test)]
const STOCK_MODEL_FILE: &str = "onnx/model_quantized.onnx";
/// EmbeddingGemma's output width.
pub const DIMENSIONS: usize = 768;
/// Longest input embedded, in tokens (special tokens included). Sermon
/// sentences and verses are far shorter; this bounds a pathological input.
const MAX_TOKENS: usize = 512;
/// Texts per inference call. A batch pads to its longest member, so this
/// trades padding waste against per-call overhead.
const BATCH: usize = 16;

pub struct Embedder {
    session: Session,
    tokenizer: Tokenizer,
    pad_id: i64,
}

impl Embedder {
    pub fn load(model_dir: &Path) -> Result<Self, String> {
        Self::load_graph(model_dir, MODEL_FILE)
    }

    fn load_graph(model_dir: &Path, graph: &str) -> Result<Self, String> {
        let started = std::time::Instant::now();
        let tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|e| format!("failed to load embedding tokenizer: {e}"))?;
        let pad_id = tokenizer.token_to_id("<pad>").unwrap_or(0) as i64;

        // Leave cores for audio capture, transcription and the UI.
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(2).clamp(1, 4))
            .unwrap_or(2);
        let fail = |e: ort::Error<_>| format!("failed to load embedding model: {e}");
        let session = Session::builder()
            .map_err(|e| format!("failed to load embedding model: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(fail)?
            .with_intra_threads(threads)
            .map_err(fail)?
            // Inputs change shape every call (batch size, sentence length).
            // The arena and memory patterns are tuned for fixed shapes and keep
            // the high-water mark of every shape seen; plain allocation keeps
            // the footprint flat over a long service.
            .with_memory_pattern(false)
            .map_err(fail)?
            .with_execution_providers([ep::CPU::default().with_arena_allocator(false).build()])
            .map_err(fail)?
            .commit_from_file(model_dir.join(graph))
            .map_err(|e| format!("failed to load embedding model: {e}"))?;

        info!(
            "[embeddings] loaded EmbeddingGemma in {} ms ({} threads)",
            started.elapsed().as_millis(),
            threads
        );
        Ok(Self {
            session,
            tokenizer,
            pad_id,
        })
    }

    /// Embed `texts`, returning `texts.len() * DIMENSIONS` floats, row-major.
    pub fn embed(&mut self, texts: &[String]) -> Result<Vec<f32>, String> {
        let mut out = Vec::with_capacity(texts.len() * DIMENSIONS);
        for chunk in texts.chunks(BATCH) {
            self.embed_batch(chunk, &mut out)?;
        }
        Ok(out)
    }

    fn embed_batch(&mut self, texts: &[String], out: &mut Vec<f32>) -> Result<(), String> {
        let encodings = self
            .tokenizer
            .encode_batch(texts.to_vec(), true)
            .map_err(|e| format!("tokenization failed: {e}"))?;

        // Right-padded, as Transformers.js pads, with truncation that keeps
        // the closing <eos> the template added.
        let rows = encodings.len();
        let width = encodings
            .iter()
            .map(|e| e.get_ids().len().min(MAX_TOKENS))
            .max()
            .unwrap_or(0)
            .max(1);
        let mut ids = vec![self.pad_id; rows * width];
        let mut mask = vec![0i64; rows * width];
        for (r, enc) in encodings.iter().enumerate() {
            let tokens = enc.get_ids();
            let len = tokens.len().min(MAX_TOKENS);
            for (c, &id) in tokens[..len].iter().enumerate() {
                ids[r * width + c] = id as i64;
                mask[r * width + c] = 1;
            }
            if let Some(&last) = tokens.last().filter(|_| tokens.len() > MAX_TOKENS) {
                ids[r * width + len - 1] = last as i64;
            }
        }

        let shape = [rows as i64, width as i64];
        let input_ids = Tensor::from_array((shape, ids)).map_err(|e| e.to_string())?;
        let attention_mask = Tensor::from_array((shape, mask)).map_err(|e| e.to_string())?;
        let outputs = self
            .session
            .run(ort::inputs! {
                "input_ids" => input_ids,
                "attention_mask" => attention_mask,
            })
            .map_err(|e| format!("embedding inference failed: {e}"))?;
        let (shape, data) = outputs["sentence_embedding"]
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("unexpected embedding output: {e}"))?;
        if shape.len() != 2 || shape[0] as usize != rows || shape[1] as usize != DIMENSIONS {
            return Err(format!("unexpected embedding shape {shape:?}"));
        }
        out.extend_from_slice(data);
        Ok(())
    }
}

static EMBEDDER: Mutex<Option<Embedder>> = Mutex::new(None);

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no resource dir: {e}"))?
        .join(MODEL_DIR);
    if !dir.join(MODEL_FILE).exists() {
        return Err(format!(
            "embedding model not bundled at {} (run scripts/download-embedding-model.mjs)",
            dir.display()
        ));
    }
    Ok(dir)
}

fn embed_blocking(app: &AppHandle, texts: &[String]) -> Result<Vec<f32>, String> {
    let mut slot = EMBEDDER
        .lock()
        .map_err(|_| "embedder lock poisoned".to_string())?;
    let embedder = match slot.take() {
        Some(embedder) => embedder,
        None => Embedder::load(&model_dir(app)?)?,
    };
    slot.insert(embedder).embed(texts)
}

/// Embed `texts` (already carrying their task prefix). Returns the vectors as
/// raw little-endian f32 bytes — `texts.len() × 768` of them — which reach the
/// frontend as an ArrayBuffer instead of a JSON array of numbers. An empty
/// list just loads the model.
#[tauri::command]
pub async fn embed_texts(
    app: AppHandle,
    texts: Vec<String>,
) -> Result<tauri::ipc::Response, String> {
    let vectors = tauri::async_runtime::spawn_blocking(move || embed_blocking(&app, &texts))
        .await
        .map_err(|e| format!("embedding task failed: {e}"))??;
    let bytes: Vec<u8> = vectors.iter().flat_map(|v| v.to_le_bytes()).collect();
    Ok(tauri::ipc::Response::new(bytes))
}

/// Drop the model, returning its memory. The next `embed_texts` reloads it.
#[tauri::command]
pub fn embeddings_unload() {
    if let Ok(mut slot) = EMBEDDER.lock() {
        if slot.take().is_some() {
            info!("[embeddings] unloaded EmbeddingGemma");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local_model_dir() -> Option<PathBuf> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join(MODEL_DIR);
        dir.join(MODEL_FILE).exists().then_some(dir)
    }

    fn cosine(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| x * y).sum()
    }

    /// The desktop verse pack was built with Transformers.js in Node; queries
    /// are embedded here. They must agree, or every score is off. Skips
    /// when the model hasn't been downloaded (`npm run download-embedding-model`).
    #[test]
    fn reproduces_the_verse_pack() {
        let Some(dir) = local_model_dir() else {
            eprintln!("embedding model not downloaded; skipping");
            return;
        };
        let pack_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("semantic-packs/WEB");
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pack_dir.join("manifest.json")).unwrap())
                .unwrap();
        let scale = manifest["scale"].as_f64().unwrap() as f32;
        let dim = manifest["dim"].as_u64().unwrap() as usize;
        assert_eq!(dim, DIMENSIONS);
        let metadata: Vec<serde_json::Value> =
            serde_json::from_slice(&std::fs::read(pack_dir.join("metadata.json")).unwrap())
                .unwrap();
        let packed = std::fs::read(pack_dir.join("embeddings.i8")).unwrap();

        let mut embedder = Embedder::load(&dir).unwrap();
        // Spread across the Bible, with different lengths in one batch.
        let picks = [0usize, 1, 7_000, 15_000, 23_144, 26_045, 31_099];
        let texts: Vec<String> = picks
            .iter()
            .map(|&i| {
                format!(
                    "title: none | text: {}",
                    metadata[i]["text"].as_str().unwrap()
                )
            })
            .collect();
        let vectors = embedder.embed(&texts).unwrap();

        for (n, &i) in picks.iter().enumerate() {
            let ours = &vectors[n * dim..(n + 1) * dim];
            let pack: Vec<f32> = packed[i * dim..(i + 1) * dim]
                .iter()
                .map(|&q| q as i8 as f32 / scale)
                .collect();
            let norm = cosine(&pack, &pack).sqrt();
            let sim = cosine(ours, &pack) / norm;
            assert!(sim > 0.995, "verse {i}: cosine {sim} with the pack");
            assert!((cosine(ours, ours) - 1.0).abs() < 1e-3, "not normalised");
        }
    }

    /// Resident memory of this process, in MB.
    fn rss_mb() -> f64 {
        let out = std::process::Command::new("ps")
            .args(["-o", "rss=", "-p", &std::process::id().to_string()])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
            / 1024.0
    }

    /// What 0.1.26 failed in the webview: hours of sermon-sized batches must
    /// not grow memory. Run with `-- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn memory_stays_flat_over_a_long_service() {
        let Some(dir) = local_model_dir() else { return };
        let mut embedder = Embedder::load(&dir).unwrap();
        let words = "for God so loved the world that he gave his only begotten son and \
                     whosoever believeth in him should not perish but have everlasting life"
            .split(' ')
            .collect::<Vec<_>>();
        // Batches of 1-12 sentences of 4-30 words, varying every call, as the
        // live detector sends them.
        let batch = |n: usize| -> Vec<String> {
            (0..1 + n % 12)
                .map(|i| {
                    let len = 4 + (n * 7 + i * 13) % 27;
                    let text = (0..len)
                        .map(|w| words[(n + i + w) % words.len()])
                        .collect::<Vec<_>>();
                    format!("task: search result | query: {}", text.join(" "))
                })
                .collect()
        };
        for n in 0..50 {
            embedder.embed(&batch(n)).unwrap();
        }
        let warm = rss_mb();
        let started = std::time::Instant::now();
        let runs = 1500;
        for n in 0..runs {
            embedder.embed(&batch(n)).unwrap();
            if n % 300 == 0 {
                eprintln!("batch {n}: {:.0} MB", rss_mb());
            }
        }
        let end = rss_mb();
        eprintln!(
            "warm {warm:.0} MB -> {end:.0} MB after {runs} batches, {:.1} ms per batch",
            started.elapsed().as_secs_f64() * 1000.0 / runs as f64
        );
        assert!(end - warm < 100.0, "grew {:.0} MB", end - warm);
        // ~650 MB measured on macOS. The stock graph sat at 1.6 GB, rebuilding
        // the 805 MB float32 token table on every call.
        assert!(end < 1000.0, "footprint {end:.0} MB");
    }

    /// The rewritten graph only reorders the embedding lookup; anything but
    /// identical output means the rewrite changed the model.
    #[test]
    fn rewritten_graph_matches_the_stock_one() {
        let Some(dir) = local_model_dir() else { return };
        let texts: Vec<String> = [
            "task: search result | query: for God so loved the world",
            "title: none | text: In the beginning God created the heaven and the earth.",
            "task: clustering | query: turn with me to Romans chapter eight this morning",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let ours = Embedder::load(&dir).unwrap().embed(&texts).unwrap();
        let stock = Embedder::load_graph(&dir, STOCK_MODEL_FILE)
            .unwrap()
            .embed(&texts)
            .unwrap();
        assert_eq!(ours, stock);
    }

    /// Padding a short text into a batch with a long one must not change it.
    #[test]
    fn batching_does_not_change_vectors() {
        let Some(dir) = local_model_dir() else { return };
        let mut embedder = Embedder::load(&dir).unwrap();
        let short = "task: search result | query: the Lord is my shepherd".to_string();
        let long = format!(
            "task: search result | query: {}",
            "and it came to pass ".repeat(20)
        );
        let alone = embedder.embed(&[short.clone()]).unwrap();
        let batched = embedder.embed(&[long, short]).unwrap();
        let sim = cosine(&alone, &batched[DIMENSIONS..]);
        assert!(sim > 0.9999, "cosine {sim}");
    }
}
