from faster_whisper import WhisperModel
import hashlib
import os
import threading

# int8 keeps CPU usage manageable; default to better accuracy than tiny.
# Override with env var, e.g. WHISPER_MODEL=tiny for speed.
_MODEL_NAME = os.getenv("WHISPER_MODEL", "base").strip() or "base"
model = WhisperModel(_MODEL_NAME, device="cpu", compute_type="int8")
_model_lock = threading.Lock()

# Simple cache: filepath -> transcription result
_transcription_cache = {}
_CACHE_SIZE_LIMIT = 10  # Keep last 10 transcriptions in memory

def _get_cache_key(audio_path):
    """Generate cache key from file path and modification time."""
    try:
        mtime = os.path.getmtime(audio_path)
        key = f"{audio_path}:{mtime}"
        return hashlib.md5(key.encode()).hexdigest()
    except:
        return None

def transcribe_audio_with_segments(
    audio_path,
    vad_filter=True,
    use_cache=True,
    beam_size=1,
    language="en",
    condition_on_previous_text=False,
    wait_for_model=True,
    model_lock_timeout=None,
):
    """
    Uses faster-whisper (4-8x faster than openai-whisper).
    Returns full text + segments with timestamps.
    Includes caching to avoid re-transcribing the same file.
    """
    # Check cache first
    cache_key = _get_cache_key(audio_path) if use_cache else None
    if use_cache and cache_key and cache_key in _transcription_cache:
        return _transcription_cache[cache_key]

    if wait_for_model:
        if model_lock_timeout is None:
            acquired = _model_lock.acquire()
        else:
            acquired = _model_lock.acquire(timeout=max(0, float(model_lock_timeout)))
    else:
        acquired = _model_lock.acquire(blocking=False)

    if not acquired:
        return {"text": "", "segments": [], "skipped": "model_busy"}

    try:
        kwargs = {
            "language": language,
            "beam_size": beam_size,
            "vad_filter": vad_filter,
            "condition_on_previous_text": condition_on_previous_text,
            "temperature": 0.0,
        }
        if vad_filter:
            kwargs["vad_parameters"] = dict(min_silence_duration_ms=500)

        segments_iter, info = model.transcribe(audio_path, **kwargs)

        segments = []
        full_text = []

        for seg in segments_iter:
            segments.append({
                "start": seg.start,
                "end": seg.end,
                "text": seg.text.strip()
            })
            full_text.append(seg.text.strip())

        result = {
            "text": " ".join(full_text),
            "segments": segments
        }
    finally:
        _model_lock.release()
    
    # Cache result (with size limit)
    if use_cache and cache_key:
        _transcription_cache[cache_key] = result
        if len(_transcription_cache) > _CACHE_SIZE_LIMIT:
            # Remove oldest entry (simple FIFO)
            first_key = next(iter(_transcription_cache))
            del _transcription_cache[first_key]
    
    return result