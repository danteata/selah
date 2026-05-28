#!/usr/bin/env python3
"""
Faster-Whisper Server for Selah Desktop App

A lightweight HTTP server that provides transcription endpoints using faster-whisper.
This is bundled with the desktop app for offline transcription support.

Usage:
    python whisper-server.py [--port PORT] [--model MODEL]

Options:
    --port PORT     Port to run the server on (default: 17493)
    --model MODEL   Whisper model to use (default: base.en)
                    Options: tiny, tiny.en, base, base.en, small, small.en, medium, medium.en, large-v3
    --device DEVICE Device to use for inference (default: auto)
                    Options: auto, cpu, cuda
    --compute-type TYPE
                    Compute type for inference (default: auto)
                    Options: auto, int8, float16, float32
"""

# Fix for PyInstaller multiprocessing issue on macOS
import multiprocessing
multiprocessing.freeze_support()

import argparse
import io
import json
import logging
import os
import sys
import tempfile
import wave
from pathlib import Path
from typing import Optional

try:
    from flask import Flask, request, jsonify
    from faster_whisper import WhisperModel
    from flask_cors import CORS
except ImportError:
    print("Error: Required packages not installed.")
    print("Please install with: pip install flask flask-cors faster-whisper")
    sys.exit(1)

# Optional: summarization support using sumy (lightweight extractive summarization)
try:
    import nltk
    from sumy.parsers.plaintext import PlaintextParser
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.summarizers.lsa import LsaSummarizer
    from sumy.summarizers.text_rank import TextRankSummarizer
    from sumy.nlp.stemmers import Stemmer
    from sumy.utils import get_stop_words
    
    # Download required NLTK data on import
    nltk.download('punkt', quiet=True)
    nltk.download('punkt_tab', quiet=True)
    
    SUMMARIZATION_AVAILABLE = True
except ImportError as e:
    SUMMARIZATION_AVAILABLE = False
    logger_init = logging.getLogger('whisper-server')
    logger_init.warning(f"sumy not installed - summarization disabled: {e}")

# Optional: abstractive summarization using Hugging Face transformers
# (lazy-loaded on first request, adds ~330MB download for distilbart model)
ABSTRACTIVE_SUMMARIZER = None
ABSTRACTIVE_SUMMARIZATION_AVAILABLE = False

try:
    from transformers import pipeline
    ABSTRACTIVE_SUMMARIZATION_AVAILABLE = True
except ImportError:
    pass

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('whisper-server')

app = Flask(__name__)
# Enable CORS for all routes - needed for desktop app to communicate with server
CORS(app)

# Global model instance
model: Optional[WhisperModel] = None
model_name: Optional[str] = None

# Global summarizer instance (lightweight, no model download needed)
summarizer = None
SUMMARIZATION_LANGUAGE = 'english'


def get_model_size(model_id: str) -> str:
    """Get approximate model size for progress estimation."""
    sizes = {
        'tiny': '75MB',
        'tiny.en': '75MB',
        'base': '150MB',
        'base.en': '150MB',
        'small': '500MB',
        'small.en': '500MB',
        'medium': '1.5GB',
        'medium.en': '1.5GB',
        'large-v1': '3GB',
        'large-v2': '3GB',
        'large-v3': '3GB',
        'distil-large-v3': '1.5GB',
    }
    return sizes.get(model_id, 'unknown')


def check_vad_available() -> bool:
    """Check if Silero VAD model is available.
    
    The VAD model (silero_vad_v6.onnx) is not bundled with PyInstaller by default.
    This function checks if it's available before enabling VAD filter.
    """
    try:
        # Check if running in PyInstaller bundle
        if getattr(sys, 'frozen', False):
            # Running in PyInstaller bundle - VAD model is not bundled
            return False
        
        # Running in normal Python - check if faster_whisper has VAD assets
        import faster_whisper
        faster_whisper_path = Path(faster_whisper.__file__).parent
        vad_path = faster_whisper_path / 'assets' / 'silero_vad_v6.onnx'
        return vad_path.exists()
    except Exception:
        return False


def load_model(model_id: str, device: str = 'auto', compute_type: str = 'auto', model_path: Optional[str] = None):
    """Load the Whisper model.
    
    If model_path is provided, load from that local directory instead of downloading.
    Otherwise, resolve model_id to a HuggingFace repo ID.
    """
    global model, model_name
    
    if model is not None and model_name == model_id:
        return model
    
    logger.info(f"Loading model: {model_id}")
    if model_path:
        logger.info(f"Using local model path: {model_path}")
    logger.info(f"Device: {device}, Compute type: {compute_type}")
    
    model_source = model_path
    if not model_source:
        model_map = {
            'tiny': 'Systran/faster-whisper-tiny',
            'tiny.en': 'Systran/faster-whisper-tiny.en',
            'base': 'Systran/faster-whisper-base',
            'base.en': 'Systran/faster-whisper-base.en',
            'small': 'Systran/faster-whisper-small',
            'small.en': 'Systran/faster-whisper-small.en',
            'medium': 'Systran/faster-whisper-medium',
            'medium.en': 'Systran/faster-whisper-medium.en',
            'large-v1': 'Systran/faster-whisper-large-v1',
            'large-v2': 'Systran/faster-whisper-large-v2',
            'large-v3': 'Systran/faster-whisper-large-v3',
            'distil-large-v3': 'Systran/faster-distil-whisper-large-v3',
        }
        model_source = model_map.get(model_id, model_id)
    
    try:
        model = WhisperModel(
            model_source,
            device=device,
            compute_type=compute_type,
        )
        model_name = model_id
        logger.info(f"Model loaded successfully: {model_id}")
        return model
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'healthy',
        'model': model_name,
        'model_loaded': model is not None,
        'summarization_available': SUMMARIZATION_AVAILABLE,
        'summarizer_loaded': summarizer is not None,
        'abstractive_available': ABSTRACTIVE_SUMMARIZATION_AVAILABLE,
        'abstractive_loaded': ABSTRACTIVE_SUMMARIZER is not None,
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Transcribe audio file.
    
    Supports two response formats:
    - JSON (default): Returns complete result as a single JSON object.
    - ndjson: Streams segment events as newline-delimited JSON.
      Activated by passing response_format=ndjson in form data.
      Events: {"type":"segment","start":...,"end":...,"text":"..."}
              {"type":"result","text":"...","language":"...","language_probability":...,"segments":[...]}
              {"type":"error","code":"...","message":"..."}
    """
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    try:
        # Check for audio file in request
        if 'audio' not in request.files:
            logger.error('No audio file provided in request')
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        
        # Log file info
        logger.info(f"Received audio file: {audio_file.filename}, content_type: {audio_file.content_type}")
        
        # Get optional parameters
        language = request.form.get('language', None)
        task = request.form.get('task', 'transcribe')
        vad_filter_requested = request.form.get('vad_filter', 'false').lower() == 'true'
        vad_filter = vad_filter_requested and check_vad_available()
        hotwords = request.form.get('hotwords', None)
        initial_prompt = request.form.get('initial_prompt', None)
        response_format = request.form.get('response_format', 'json').lower()
        
        # Save to temp file and transcribe
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        # Check file size
        file_size = os.path.getsize(tmp_path)
        logger.info(f"Saved audio file to {tmp_path}, size: {file_size} bytes")
        
        if file_size < 44:
            logger.error(f"Audio file too small: {file_size} bytes")
            os.unlink(tmp_path)
            return jsonify({'error': f'Audio file too small: {file_size} bytes'}), 400
        
        try:
            # Run transcription
            logger.info(f"Starting transcription with language={language}, vad_filter={vad_filter}, initial_prompt={initial_prompt!r}, format={response_format}")
            segments, info = model.transcribe(
                tmp_path,
                language=language,
                task=task,
                vad_filter=vad_filter,
                hotwords=hotwords,
                initial_prompt=initial_prompt,
            )
            
            if response_format == 'ndjson':
                return _stream_ndjson(segments, info, tmp_path)
            
            # JSON mode: collect all results
            text = ''
            segment_list = []
            for segment in segments:
                text += segment.text
                segment_list.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text,
                })
            
            logger.info(f"Transcription complete: {len(text)} chars, {len(segment_list)} segments")
            
            return jsonify({
                'text': text.strip(),
                'language': info.language,
                'language_probability': info.language_probability,
                'segments': segment_list,
            })
        finally:
            if response_format != 'ndjson':
                os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


def _stream_ndjson(segments_iter, info, tmp_path):
    """Stream transcription results as newline-delimited JSON.
    
    Events emitted:
    - {"type":"segment","start":...,"end":...,"text":"..."} for each segment as decoded
    - {"type":"result","text":"...","language":"...","language_probability":...,"segments":[...]} at the end
    - {"type":"error","code":"...","message":"..."} on error
    
    Cleans up tmp_path when streaming is done.
    """
    from flask import Response
    
    def generate():
        try:
            text_parts = []
            all_segments = []
            
            for segment in segments_iter:
                seg_data = {
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text,
                }
                all_segments.append(seg_data)
                text_parts.append(segment.text)
                yield json.dumps({'type': 'segment', **seg_data}) + '\n'
            
            full_text = ''.join(text_parts).strip()
            result = {
                'type': 'result',
                'text': full_text,
                'language': info.language,
                'language_probability': info.language_probability,
                'segments': all_segments,
            }
            yield json.dumps(result) + '\n'
        except Exception as e:
            logger.error(f"ndjson streaming error: {e}", exc_info=True)
            yield json.dumps({'type': 'error', 'code': 'streaming_error', 'message': str(e)}) + '\n'
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
    
    return Response(generate(), mimetype='application/x-ndjson')


@app.route('/transcribe-raw', methods=['POST'])
def transcribe_raw():
    """Transcribe raw audio data (PCM or WAV bytes).
    
    Supports response_format=ndjson via X-Response-Format header for streaming.
    """
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    try:
        # Get raw audio data
        audio_data = request.data
        
        if not audio_data:
            return jsonify({'error': 'No audio data provided'}), 400
        
        # Get parameters from headers or query
        sample_rate = int(request.headers.get('X-Sample-Rate', 16000))
        language = request.headers.get('X-Language', None)
        hotwords = request.headers.get('X-Hotwords', None)
        initial_prompt = request.headers.get('X-Initial-Prompt', None)
        vad_filter_requested = request.headers.get('X-VAD-Filter', 'false').lower() == 'true'
        vad_filter = vad_filter_requested and check_vad_available()
        response_format = request.headers.get('X-Response-Format', 'json').lower()
        
        # Convert raw PCM to WAV
        with io.BytesIO() as wav_buffer:
            with wave.open(wav_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(audio_data)
            wav_data = wav_buffer.getvalue()
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp.write(wav_data)
            tmp_path = tmp.name
        
        try:
            # Run transcription
            segments, info = model.transcribe(
                tmp_path,
                language=language,
                vad_filter=vad_filter,
                hotwords=hotwords,
                initial_prompt=initial_prompt,
            )
            
            if response_format == 'ndjson':
                return _stream_ndjson(segments, info, tmp_path)
            
            # Collect results
            text = ''
            segment_list = []
            for segment in segments:
                text += segment.text
                segment_list.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text,
                })
            
            return jsonify({
                'text': text.strip(),
                'language': info.language,
                'segments': segment_list,
            })
        finally:
            if response_format != 'ndjson':
                os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/load-model', methods=['POST'])
def load_model_endpoint():
    """Load a specific model."""
    try:
        data = request.get_json() or {}
        model_id = data.get('model', 'base.en')
        device = data.get('device', 'auto')
        compute_type = data.get('compute_type', 'auto')
        
        load_model(model_id, device, compute_type)
        
        return jsonify({
            'status': 'success',
            'model': model_id,
        })
    except Exception as e:
        logger.error(f"Model load error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/models', methods=['GET'])
def list_models():
    """List available models."""
    return jsonify({
        'models': [
            {'id': 'tiny', 'size': '75MB', 'description': 'Fastest, least accurate'},
            {'id': 'tiny.en', 'size': '75MB', 'description': 'Tiny English-only'},
            {'id': 'base', 'size': '150MB', 'description': 'Good balance of speed and accuracy'},
            {'id': 'base.en', 'size': '150MB', 'description': 'Base English-only (recommended)'},
            {'id': 'small', 'size': '500MB', 'description': 'Better accuracy, slower'},
            {'id': 'small.en', 'size': '500MB', 'description': 'Small English-only'},
            {'id': 'medium', 'size': '1.5GB', 'description': 'High accuracy, slow'},
            {'id': 'medium.en', 'size': '1.5GB', 'description': 'Medium English-only'},
            {'id': 'large-v3', 'size': '3GB', 'description': 'Best accuracy, slowest'},
            {'id': 'distil-large-v3', 'size': '1.5GB', 'description': 'Distilled large model, fast and accurate'},
        ],
        'current_model': model_name,
    })


def get_summarizer():
    """Return the sumy summarizer (TextRank - lightweight, no model download)."""
    global summarizer
    if summarizer is not None:
        return summarizer

    if not SUMMARIZATION_AVAILABLE:
        raise RuntimeError("sumy library not installed")

    logger.info("Initializing TextRank summarizer")
    stemmer = Stemmer(SUMMARIZATION_LANGUAGE)
    summarizer = TextRankSummarizer(stemmer)
    summarizer.stop_words = get_stop_words(SUMMARIZATION_LANGUAGE)
    logger.info("TextRank summarizer ready")
    return summarizer


def get_abstractive_summarizer():
    """Lazy-load the abstractive summarization model (distilbart-cnn-6-6).
    
    Only loads on first call to avoid slowing startup. The model is ~330MB
    and downloads automatically from HuggingFace on first use.
    """
    global ABSTRACTIVE_SUMMARIZER
    if ABSTRACTIVE_SUMMARIZER is not None:
        return ABSTRACTIVE_SUMMARIZER

    if not ABSTRACTIVE_SUMMARIZATION_AVAILABLE:
        raise RuntimeError("transformers library not installed - abstractive summarization unavailable")

    logger.info("Loading abstractive summarization model (sshleifer/distilbart-cnn-6-6)...")
    ABSTRACTIVE_SUMMARIZER = pipeline(
        "summarization",
        model="sshleifer/distilbart-cnn-6-6",
        device=-1,  # CPU; set to 0 for GPU
    )
    logger.info("Abstractive summarization model ready")
    return ABSTRACTIVE_SUMMARIZER


@app.route('/summarize', methods=['POST'])
def summarize():
    """Summarize text using extractive TextRank summarization."""
    if not SUMMARIZATION_AVAILABLE:
        return jsonify({'error': 'Summarization not available (sumy not installed)'}), 500

    try:
        data = request.get_json() or {}
        text = data.get('text', '').strip()

        if not text or len(text) < 50:
            return jsonify({'error': 'Text too short to summarize'}), 400

        sentence_count = data.get('sentence_count', 8)

        logger.info(f"Summarizing text ({len(text)} chars, {sentence_count} sentences)")

        summarizer_fn = get_summarizer()
        parser = PlaintextParser.from_string(text, Tokenizer(SUMMARIZATION_LANGUAGE))
        
        sentences = summarizer_fn(parser.document, sentence_count)
        summary = ' '.join(str(s) for s in sentences)

        logger.info(f"Summarization complete: {len(summary)} chars")
        return jsonify({'summary': summary.strip()})

    except Exception as e:
        logger.error(f"Summarization error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/summarize-abstractive', methods=['POST'])
def summarize_abstractive():
    """Summarize text using the best available method.
    
    Priority:
    1. If transformers is installed: use distilbart-cnn-6-6 for true abstractive summarization
    2. Otherwise: use TextRank extractive + sentence cleaning for a semi-paraphrased output
    
    The model is lazy-loaded on the first abstractive request.
    """
    try:
        data = request.get_json() or {}
        text = data.get('text', '').strip()

        if not text or len(text) < 50:
            return jsonify({'error': 'Text too short to summarize (min 50 chars)'}), 400

        max_length = data.get('max_length', 150)
        min_length = data.get('min_length', 30)

        # Try abstractive model if available (requires transformers + torch)
        if ABSTRACTIVE_SUMMARIZATION_AVAILABLE:
            try:
                summarizer = get_abstractive_summarizer()
                input_text = text[:4000]  # Truncate to safe limit
                result = summarizer(input_text, max_length=max_length, min_length=min_length, do_sample=False)
                
                if result and result[0].get('summary_text'):
                    summary = result[0]['summary_text'].strip()
                    if summary:
                        logger.info(f"Abstractive summarization complete: {len(summary)} chars")
                        return jsonify({
                            'summary': summary,
                            'method': 'abstractive',
                            'model': 'sshleifer/distilbart-cnn-6-6',
                        })
            except Exception as e:
                logger.warning(f"Abstractive model failed, falling back to extractive: {e}")

        # Fallback: use TextRank + sentence reconstruction for a summary that
        # reads more like a continuous paragraph rather than bullet points
        if SUMMARIZATION_AVAILABLE:
            try:
                sentence_count = max(4, min_length // 15)  # ~15 words per sentence
                summarizer_fn = get_summarizer()
                parser = PlaintextParser.from_string(text, Tokenizer(SUMMARIZATION_LANGUAGE))
                sentences = summarizer_fn(parser.document, sentence_count)
                
                if sentences:
                    # Join with spaces and clean up for paragraph-style output
                    summary = ' '.join(str(s).strip() for s in sentences)
                    # Capitalize first letter after period if lowercase
                    import re
                    summary = re.sub(r'\.\s+([a-z])', lambda m: '. ' + m.group(1).upper(), summary)
                    # Ensure starts with uppercase
                    if summary and summary[0].islower():
                        summary = summary[0].upper() + summary[1:]
                    
                    logger.info(f"Extractive-then-clean summarization: {len(summary)} chars")
                    return jsonify({
                        'summary': summary.strip(),
                        'method': 'extractive-enhanced',
                        'model': 'sumy-textrank',
                    })
            except Exception as e:
                logger.warning(f"Extractive summarization also failed: {e}")

        # Neither available
        return jsonify({
            'error': 'No summarization method available',
            'available': False,
        }), 501

    except Exception as e:
        logger.error(f"Summarization error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/summarize/status', methods=['GET'])
def summarize_status():
    """Check which summarization methods are available."""
    return jsonify({
        'extractive_available': SUMMARIZATION_AVAILABLE,
        'abstractive_available': ABSTRACTIVE_SUMMARIZATION_AVAILABLE,
        'abstractive_loaded': ABSTRACTIVE_SUMMARIZER is not None,
    })


def main():
    parser = argparse.ArgumentParser(description='Faster-Whisper Server for Selah')
    parser.add_argument('--port', type=int, default=17493, help='Server port')
    parser.add_argument('--model', type=str, default='base.en', help='Whisper model to use')
    parser.add_argument('--model-path', type=str, default=None,
                        help='Local path to a pre-downloaded CTranslate2 model directory. '
                             'If provided, --model is used as a label only and the local path is loaded directly.')
    parser.add_argument('--device', type=str, default='auto', help='Device for inference')
    parser.add_argument('--compute-type', type=str, default='auto', help='Compute type')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    
    args = parser.parse_args()
    
    logger.info(f"Starting Faster-Whisper Server on port {args.port}")
    logger.info(f"Initial model: {args.model}")
    if args.model_path:
        logger.info(f"Model path: {args.model_path}")
    
    try:
        load_model(args.model, args.device, args.compute_type, model_path=args.model_path)
    except Exception as e:
        logger.warning(f"Could not load initial model: {e}")
        logger.warning("Model will be loaded on first transcription request")
    
    # Start server
    app.run(
        host=args.host,
        port=args.port,
        threaded=True,
    )


if __name__ == '__main__':
    main()
