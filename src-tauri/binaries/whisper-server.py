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


def load_model(model_id: str, device: str = 'auto', compute_type: str = 'auto'):
    """Load the Whisper model."""
    global model, model_name
    
    if model is not None and model_name == model_id:
        return model
    
    logger.info(f"Loading model: {model_id}")
    logger.info(f"Device: {device}, Compute type: {compute_type}")
    
    # Map short names to full model IDs
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
    
    full_model_id = model_map.get(model_id, model_id)
    
    try:
        model = WhisperModel(
            full_model_id,
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
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Transcribe audio file."""
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 500
    
    try:
        # Check for audio file in request
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
        
        audio_file = request.files['audio']
        
        # Get optional parameters
        language = request.form.get('language', None)
        task = request.form.get('task', 'transcribe')  # transcribe or translate
        vad_filter = request.form.get('vad_filter', 'true').lower() == 'true'
        hotwords = request.form.get('hotwords', None)
        
        # Save to temp file and transcribe
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name
        
        try:
            # Run transcription
            segments, info = model.transcribe(
                tmp_path,
                language=language,
                task=task,
                vad_filter=vad_filter,
                hotwords=hotwords,
            )
            
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
                'language_probability': info.language_probability,
                'segments': segment_list,
            })
        finally:
            # Clean up temp file
            os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/transcribe-raw', methods=['POST'])
def transcribe_raw():
    """Transcribe raw audio data (PCM or WAV bytes)."""
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
        vad_filter = request.headers.get('X-VAD-Filter', 'true').lower() == 'true'
        
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
            )
            
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


def main():
    parser = argparse.ArgumentParser(description='Faster-Whisper Server for Selah')
    parser.add_argument('--port', type=int, default=17493, help='Server port')
    parser.add_argument('--model', type=str, default='base.en', help='Whisper model to use')
    parser.add_argument('--device', type=str, default='auto', help='Device for inference')
    parser.add_argument('--compute-type', type=str, default='auto', help='Compute type')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    
    args = parser.parse_args()
    
    # Load initial model
    logger.info(f"Starting Faster-Whisper Server on port {args.port}")
    logger.info(f"Initial model: {args.model}")
    
    try:
        load_model(args.model, args.device, args.compute_type)
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
