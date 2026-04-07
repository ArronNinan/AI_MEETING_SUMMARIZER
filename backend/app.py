from flask import Flask, request, jsonify, send_file, session
from flask_cors import CORS
import importlib, io, os, uuid, json, requests, threading, subprocess, tempfile, hashlib, secrets
from datetime import datetime
from pydub import AudioSegment
from pydub.silence import detect_nonsilent
from modules.transcriber import transcribe_audio_with_segments
from modules.summarizer import summarize_and_extract, llm_health
from tasks import tasks, run_background_task

app = Flask(__name__)

# Persist secret key across restarts so sessions stay valid
_KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".secret_key")
if os.path.exists(_KEY_FILE):
    with open(_KEY_FILE) as f: app.secret_key = f.read().strip()
else:
    _k = secrets.token_hex(32)
    with open(_KEY_FILE, "w") as f: f.write(_k)
    app.secret_key = _k

# CORS — allow React dev server with credentials
CORS(app,
     supports_credentials=True,
     origins=["http://localhost:3000", "http://127.0.0.1:3000"],
     allow_headers=["Content-Type", "Authorization"],
     expose_headers=["Content-Disposition"],
     methods=["GET","POST","DELETE","OPTIONS"])

# Cookie settings for cross-origin session
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"]   = False   # False for localhost http
app.config["SESSION_COOKIE_HTTPONLY"] = True

UPLOAD_FOLDER = "uploads"
USERS_FILE    = "users.json"
TOKENS_FILE   = "tokens.json"            # username → token map
DATA_DIR      = "user_data"              # one history file per user
REPORT_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen_report.js")
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR     = os.path.join(BASE_DIR, "cache_exports")
FULL_REPORT_TIMEOUT_SEC = int(os.getenv("FULL_REPORT_TIMEOUT_SEC", "420"))

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(DATA_DIR,      exist_ok=True)
os.makedirs(CACHE_DIR,     exist_ok=True)

# Prevent live chunk requests from starving long-running report transcription.
REPORT_TRANSCRIBE_LOCK = threading.Lock()
REPORT_TRANSCRIBE_ACTIVE = 0


def _mark_report_transcribe_start():
    global REPORT_TRANSCRIBE_ACTIVE
    with REPORT_TRANSCRIBE_LOCK:
        REPORT_TRANSCRIBE_ACTIVE += 1


def _mark_report_transcribe_end():
    global REPORT_TRANSCRIBE_ACTIVE
    with REPORT_TRANSCRIBE_LOCK:
        REPORT_TRANSCRIBE_ACTIVE = max(0, REPORT_TRANSCRIBE_ACTIVE - 1)


def _is_report_transcribe_active() -> bool:
    with REPORT_TRANSCRIBE_LOCK:
        return REPORT_TRANSCRIBE_ACTIVE > 0


def _start_task_timeout_watchdog(task_id: str, timeout_sec: int):
    """Mark long-running tasks as error so client polling does not hang forever."""
    if timeout_sec <= 0:
        return

    def watchdog():
        try:
            threading.Event().wait(timeout_sec)
            t = tasks.get(task_id)
            if not t:
                return
            if t.get("status") in {"queued", "processing"}:
                t["status"] = "error"
                t["stage"] = "timeout"
                t["error"] = (
                    f"Report generation timed out after {timeout_sec}s. "
                    "Try a shorter file, disable live mic during report generation, "
                    "or reduce LLM load."
                )
        except Exception:
            pass

    threading.Thread(target=watchdog, daemon=True).start()


# ══════════════════════════════════════
#  AUTH HELPERS
# ══════════════════════════════════════
def hash_pw(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def load_users() -> dict:
    if not os.path.exists(USERS_FILE): return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f: return json.load(f)
    except: return {}

def save_users(users: dict):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

# ── Token auth (for cross-origin requests where cookies fail) ──
def load_tokens() -> dict:
    if not os.path.exists(TOKENS_FILE): return {}
    try:
        with open(TOKENS_FILE, "r", encoding="utf-8") as f: return json.load(f)
    except: return {}

def save_tokens(tokens: dict):
    with open(TOKENS_FILE, "w", encoding="utf-8") as f:
        json.dump(tokens, f, ensure_ascii=False, indent=2)

def current_user() -> str | None:
    tokens = load_tokens()

    # 1. Try Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        for username, t in tokens.items():
            if t == token:
                return username

    # 2. Try token in query param
    token = request.args.get("token", "")
    if token:
        for username, t in tokens.items():
            if t == token:
                return username

    # 3. Session cookie
    u = session.get("username")
    if u:
        return u

    return None

def require_auth():
    """Returns (username, None) or (None, error_response)."""
    u = current_user()
    if not u:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    return u, None

def require_auth_or_any():
    """For local dev — accepts any logged-in user OR returns anonymous."""
    u = current_user()
    return u or "local_user", None


# ══════════════════════════════════════
#  HISTORY (per-user)
# ══════════════════════════════════════
def history_path(username: str) -> str:
    safe = "".join(c for c in username if c.isalnum() or c in "_-")
    return os.path.join(DATA_DIR, f"{safe}_history.json")

def load_history(username: str) -> list:
    p = history_path(username)
    if not os.path.exists(p): return []
    try:
        with open(p, "r", encoding="utf-8") as f: return json.load(f)
    except: return []

def save_to_history(username: str, entry: dict):
    h = load_history(username)
    h.insert(0, entry)
    with open(history_path(username), "w", encoding="utf-8") as f:
        json.dump(h[:100], f, ensure_ascii=False, indent=2)


# ══════════════════════════════════════
#  CORE PROCESSING
# ══════════════════════════════════════
def process_audio(file_path, filename="", username=""):
    _mark_report_transcribe_start()
    try:
        tx = transcribe_audio_with_segments(file_path)["text"]
    finally:
        _mark_report_transcribe_end()
    analysis = summarize_and_extract(tx)
    sm = analysis.get("summary", "")
    secs = {k: v for k, v in analysis.items() if k != "summary"}
    
    # Calculate audio duration
    ext = os.path.splitext(file_path)[1].lower()
    audio = (AudioSegment.from_wav(file_path) if ext == ".wav"
             else AudioSegment.from_mp3(file_path) if ext in (".mp3", ".mpeg")
             else AudioSegment.from_file(file_path))
    audio_duration_sec = len(audio) / 1000
    
    if username:
        save_to_history(username, {
            "id": str(uuid.uuid4()), "type": "summary",
            "filename": filename or os.path.basename(file_path),
            "created_at": datetime.now().isoformat(),
            "audio_duration_sec": round(audio_duration_sec, 1),
            "summary": sm, "transcript": tx, "segments": [], "attendees": [], **secs
        })
    return {"transcript": tx, "summary": sm, "audio_duration_sec": round(audio_duration_sec, 1), **secs}


def process_full_report(file_path, filename="", username=""):
    _mark_report_transcribe_start()
    try:
        res = transcribe_audio_with_segments(file_path)
    finally:
        _mark_report_transcribe_end()
    tx, ws = res["text"], res.get("segments", [])
    # Use LLM for richer report wording, but cap wait so report does not hang.
    analysis = summarize_and_extract(tx, allow_llm=True, llm_timeout_sec=12, return_meta=True)
    sm = analysis.get("summary", "")
    meta = analysis.get("_meta", {}) if isinstance(analysis, dict) else {}

    ext = os.path.splitext(file_path)[1].lower()
    audio = (AudioSegment.from_wav(file_path) if ext == ".wav"
             else AudioSegment.from_mp3(file_path) if ext in (".mp3", ".mpeg")
             else AudioSegment.from_file(file_path))

    spk_segs, spk_times, spk_cnt = [], {}, {}
    audio_duration_sec = len(audio) / 1000

    # Fast speaker detection using only segment timing (no silence detection)
    if ws:
        # Speaker detection using segment gaps — much faster than silence detection
        cur, gtxt, gs, ge, pe = 1, [], None, None, None
        for seg in ws:
            s_ms, e_ms, t = seg["start"]*1000, seg["end"]*1000, seg["text"].strip()
            if not t: continue
            # Increase gap threshold to 1.5s for more reliable speaker detection
            if pe and (s_ms - pe) > 1500:
                if gtxt:
                    spk = f"Speaker {cur}"
                    spk_segs.append({"speaker": spk, "text": " ".join(gtxt), "duration": round((ge-gs)/1000,1)})
                    spk_times[spk] = spk_times.get(spk,0) + (ge-gs)
                    spk_cnt[spk]   = spk_cnt.get(spk,0) + 1
                cur = 2 if cur==1 else 1; gtxt=[]; gs=s_ms
            if gs is None: gs = s_ms
            gtxt.append(t); ge=e_ms; pe=e_ms
        if gtxt:
            spk = f"Speaker {cur}"
            spk_segs.append({"speaker": spk, "text": " ".join(gtxt), "duration": round((ge-gs)/1000,1)})
            spk_times[spk] = spk_times.get(spk,0)+(ge-gs); spk_cnt[spk]=spk_cnt.get(spk,0)+1

    if not spk_segs:
        # Fallback: single speaker
        spk_segs = [{"speaker": "Speaker 1", "text": tx, "duration": round(audio_duration_sec)}]
        spk_times = {"Speaker 1": audio_duration_sec * 1000}
        spk_cnt = {"Speaker 1": 1}

    att = sorted([{"id":k,"speaking_time":round(v/1000),"segments":spk_cnt.get(k,0)}
                  for k,v in spk_times.items()], key=lambda x:x["speaking_time"], reverse=True)
    secs = {k: v for k, v in analysis.items() if k not in {"summary", "_meta"}}
    out  = {
        "transcript": tx,
        "summary": sm,
        "segments": spk_segs,
        "attendees": att,
        "audio_duration_sec": round(audio_duration_sec, 1),
        "llm_used": bool(meta.get("llm_used", False)),
        "summary_mode": meta.get("mode", "fallback"),
        **secs,
    }

    if username:
        save_to_history(username, {
            "id": str(uuid.uuid4()), "type": "full_report",
            "filename": filename or os.path.basename(file_path),
            "created_at": datetime.now().isoformat(),
            "audio_duration_sec": round(audio_duration_sec, 1), **out
        })
    return out


# ══════════════════════════════════════
#  DOCX
# ══════════════════════════════════════
def _payload_cache_key(payload: dict) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


def build_docx(payload: dict, cache_key: str | None = None) -> str:
    """Write payload to a JSON file in BASE_DIR, run gen_report.js from BASE_DIR."""
    if cache_key:
        out_p = os.path.join(CACHE_DIR, f"{cache_key}.docx")
        if os.path.exists(out_p):
            return out_p
        in_p  = os.path.join(CACHE_DIR, f"{cache_key}.json")
    else:
        run_id = str(uuid.uuid4())[:8]
        # Keep ALL files in BASE_DIR — node_modules is there, Windows paths stay short
        in_p  = os.path.join(BASE_DIR, f"rpt_{run_id}.json")
        out_p = os.path.join(BASE_DIR, f"rpt_{run_id}.docx")

    with open(in_p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    # Pass file paths as CLI args (short paths, no JSON string on command line)
    result = subprocess.run(
        ["node", REPORT_SCRIPT, in_p, out_p],
        capture_output=True, text=True, cwd=BASE_DIR
    )

    try: os.remove(in_p)
    except: pass

    if result.returncode != 0:
        raise RuntimeError(f"Node error: {result.stdout} {result.stderr}")
    if not os.path.exists(out_p):
        raise RuntimeError("docx was not created")
    return out_p


def build_pdf_from_docx(payload: dict) -> bytes:
    """
    Convert the generated Word document to PDF.
    Uses fast methods only — skips slow Word COM conversion on first attempt.
    """
    cache_key = _payload_cache_key(payload)
    pdf_path = os.path.join(CACHE_DIR, f"{cache_key}.pdf")
    if os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            return f.read()

    docx_path = build_docx(payload, cache_key=cache_key)
    errors = []

    # 1) Try docx2pdf first (faster than Word COM)
    try:
        docx2pdf_convert = importlib.import_module("docx2pdf").convert
        if os.name == "nt":
            import ctypes
            ole32 = ctypes.windll.ole32
            com_init = ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
            try:
                docx2pdf_convert(docx_path, pdf_path)
            finally:
                if com_init in (0, 1):
                    ole32.CoUninitialize()
        else:
            docx2pdf_convert(docx_path, pdf_path)
        
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                return f.read()
    except Exception as e:
        errors.append(f"docx2pdf failed: {e}")

    # 2) Try LibreOffice headless conversion (medium speed)
    if not os.path.exists(pdf_path):
        soffice = "soffice"
        try:
            r = subprocess.run(
                [soffice, "--headless", "--convert-to", "pdf", "--outdir", BASE_DIR, docx_path],
                capture_output=True,
                text=True,
                cwd=BASE_DIR,
                timeout=15  # 15 second timeout for LibreOffice
            )
            if r.returncode == 0 and os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    return f.read()
            else:
                errors.append(f"soffice failed: {r.stdout} {r.stderr}")
        except subprocess.TimeoutExpired:
            errors.append("soffice timeout (>15s)")
        except Exception as e:
            errors.append(f"soffice unavailable: {e}")

    # 3) Try MS Word COM conversion last (slowest, only if above failed)
    if not os.path.exists(pdf_path):
        word = None
        doc = None
        try:
            pythoncom = importlib.import_module("pythoncom")
            win32_client = importlib.import_module("win32com.client")
            pythoncom.CoInitialize()
            word = win32_client.DispatchEx("Word.Application")
            word.Visible = False
            word.DisplayAlerts = 0
            abs_docx = os.path.abspath(docx_path)
            abs_pdf = os.path.abspath(pdf_path)
            doc = word.Documents.Open(
                abs_docx,
                ConfirmConversions=False,
                ReadOnly=True,
                AddToRecentFiles=False,
            )
            # 17 = wdExportFormatPDF
            doc.ExportAsFixedFormat(
                OutputFileName=abs_pdf,
                ExportFormat=17,
                OpenAfterExport=False,
                OptimizeFor=0,
                CreateBookmarks=1,
            )
            if os.path.exists(pdf_path):
                with open(pdf_path, "rb") as f:
                    return f.read()
        except Exception as e:
            errors.append(f"win32com Word conversion failed: {e}")
        finally:
            try:
                if doc is not None:
                    doc.Close(False)
            except Exception:
                pass
            try:
                if word is not None:
                    word.Quit()
            except Exception:
                pass
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass

    raise RuntimeError(
        "PDF conversion failed. Install docx2pdf or LibreOffice for PDF support. " 
        + " | ".join(errors)
    )


# ══════════════════════════════════════
#  AUTH ROUTES
# ══════════════════════════════════════
@app.route("/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if not username.replace("_","").replace("-","").isalnum():
        return jsonify({"error": "Username can only contain letters, numbers, - and _"}), 400

    users = load_users()
    if username in users:
        return jsonify({"error": "Username already taken"}), 409

    users[username] = {
        "password_hash": hash_pw(password),
        "created_at": datetime.now().isoformat(),
    }
    save_users(users)
    session["username"] = username
    # Issue a persistent token for header-based auth
    token = secrets.token_hex(32)
    tokens = load_tokens(); tokens[username] = token; save_tokens(tokens)
    return jsonify({"ok": True, "username": username, "token": token})


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.get_json()
    username = (data.get("username") or "").strip().lower()
    password = (data.get("password") or "").strip()

    users = load_users()
    user  = users.get(username)
    if not user or user["password_hash"] != hash_pw(password):
        return jsonify({"error": "Invalid username or password"}), 401

    session["username"] = username
    # Issue a persistent token
    token = secrets.token_hex(32)
    tokens = load_tokens(); tokens[username] = token; save_tokens(tokens)
    return jsonify({"ok": True, "username": username, "token": token})


@app.route("/auth/logout", methods=["POST"])
def logout():
    u = current_user()
    if u:
        tokens = load_tokens()
        tokens.pop(u, None)
        save_tokens(tokens)
    session.clear()
    return jsonify({"ok": True})


@app.route("/auth/me")
def me():
    u = current_user()
    if not u: return jsonify({"user": None})
    tokens = load_tokens()
    # Always issue a fresh token so browser stays in sync
    if u not in tokens or not tokens[u]:
        tokens[u] = secrets.token_hex(32)
        save_tokens(tokens)
    return jsonify({"user": u, "token": tokens[u]})

@app.route("/auth/token")
def get_token():
    """Re-issue token for current session user — fixes localStorage sync issues."""
    u = session.get("username")   # session-only check here
    if not u: return jsonify({"error": "Not authenticated"}), 401
    tokens = load_tokens()
    token  = secrets.token_hex(32)
    tokens[u] = token
    save_tokens(tokens)
    return jsonify({"token": token, "username": u})


# ══════════════════════════════════════
#  PROCESSING ROUTES (auth required)
# ══════════════════════════════════════
@app.route("/upload", methods=["POST"])
def upload_audio():
    user, err = require_auth()
    if err: return err
    audio = request.files.get("audio")
    if not audio: return jsonify({"error": "No audio"}), 400
    tid = str(uuid.uuid4())
    fp  = os.path.join(UPLOAD_FOLDER, f"{tid}.wav")
    audio.save(fp)
    tasks[tid] = {"status": "queued", "result": None}
    run_background_task(tid, process_audio, fp, audio.filename, user)
    return jsonify({"task_id": tid})


@app.route("/status/<tid>")
def get_status(tid):
    _, err = require_auth()
    if err: return err
    t = tasks.get(tid)
    if not t: return jsonify({"error": "Not found"}), 404
    elapsed_sec = None
    created_at = t.get("created_at")
    if created_at:
        try:
            elapsed_sec = int((datetime.now() - datetime.fromisoformat(created_at)).total_seconds())
        except Exception:
            elapsed_sec = None

    return jsonify({
        "status": t["status"],
        "stage": t.get("stage"),
        "elapsed_sec": elapsed_sec,
        "result": t.get("result"),
        "error": t.get("error")
    })


@app.route("/transcribe-chunk", methods=["POST"])
def transcribe_chunk():
    _, err = require_auth()
    if err:
        print(f"[chunk] 401 - no valid token/session")
        return err
    audio = request.files.get("audio")
    if not audio: return jsonify({"error": "No audio"}), 400

    def _pick_ext(name: str, mime: str) -> str:
        n = (name or "").lower()
        m = (mime or "").lower()
        if n.endswith(".ogg") or "ogg" in m:
            return ".ogg"
        if n.endswith(".m4a") or n.endswith(".mp4") or "mp4" in m or "mpeg" in m:
            return ".m4a"
        if n.endswith(".wav") or "wav" in m:
            return ".wav"
        return ".webm"

    chunk_id = str(uuid.uuid4())
    mime_hint = request.form.get("mime", "")
    file_ext = _pick_ext(audio.filename or "", mime_hint or getattr(audio, "mimetype", ""))
    webm_fp  = os.path.join(UPLOAD_FOLDER, f"chunk_{chunk_id}{file_ext}")
    wav_fp   = os.path.join(UPLOAD_FOLDER, f"chunk_{chunk_id}.wav")
    audio.save(webm_fp)

    try:
        if _is_report_transcribe_active():
            print("[chunk] report transcription active, skipping chunk")
            return jsonify({"transcript": ""})

        # Skip extremely small chunks to keep live pipeline responsive.
        if os.path.getsize(webm_fp) < 400:
            print("[chunk] too short, skipping")
            return jsonify({"transcript": ""})

        # Fast path: transcribe uploaded chunk directly.
        # Fallback: decode to wav for environments where direct decode is unstable.
        try:
            result = transcribe_audio_with_segments(
                webm_fp,
                vad_filter=True,
                use_cache=False,
                beam_size=1,
                language="en",
                condition_on_previous_text=False,
                wait_for_model=False,
            )
        except Exception:
            fmt = file_ext.lstrip(".")
            audio_seg = AudioSegment.from_file(webm_fp, format=fmt)
            audio_seg = audio_seg.set_frame_rate(16000).set_channels(1)
            audio_seg.export(wav_fp, format="wav")
            result = transcribe_audio_with_segments(
                wav_fp,
                vad_filter=True,
                use_cache=False,
                beam_size=1,
                language="en",
                condition_on_previous_text=False,
                wait_for_model=False,
            )

        text   = result["text"].strip()
        if result.get("skipped") == "model_busy":
            print("[chunk] model busy, skipping chunk")
            return jsonify({"transcript": ""})
        print(f"[chunk] OK — '{text[:60]}'" if text else "[chunk] OK — (silence)")
        return jsonify({"transcript": text})

    except Exception as e:
        # Do not fail the whole live session because a single chunk is malformed.
        print(f"[chunk] decode failed, skipping chunk: {e}")
        return jsonify({"transcript": "", "error": "chunk_decode_failed"}), 200
    finally:
        for fp in [webm_fp, wav_fp]:
            if os.path.exists(fp):
                try: os.remove(fp)
                except: pass


@app.route("/translate", methods=["POST"])
def translate_text():
    _, err = require_auth()
    if err: return err
    d = request.get_json()
    text, tgt = d.get("text","").strip(), d.get("target","es")
    if not text: return jsonify({"error": "No text"}), 400
    try:
        r = requests.get(f"https://api.mymemory.translated.net/get?q={requests.utils.quote(text)}&langpair=en|{tgt}", timeout=10)
        j = r.json()
        if j.get("responseStatus") == 200:
            return jsonify({"translated": j["responseData"]["translatedText"]})
        return jsonify({"error": "Translation failed"}), 500
    except Exception as e: return jsonify({"error": str(e)}), 500


@app.route("/diarize", methods=["POST"])
def diarize():
    user, err = require_auth()
    if err: return err
    audio = request.files.get("audio")
    if not audio: return jsonify({"error": "No audio"}), 400
    tid = str(uuid.uuid4())
    ext = os.path.splitext(audio.filename)[1] or ".wav"
    fp  = os.path.join(UPLOAD_FOLDER, f"diarize_{tid}{ext}")
    audio.save(fp); fname = audio.filename
    tasks[tid] = {"status": "queued", "result": None}
    def run():
        try:
            tasks[tid]["status"] = "processing"
            r = process_full_report(fp, fname, user)
            tasks[tid]["result"] = {"segments": r["segments"], "attendees": r["attendees"]}
            tasks[tid]["status"] = "completed"
        except Exception as e: tasks[tid].update({"status":"error","error":str(e)})
        finally:
            if os.path.exists(fp): os.remove(fp)
    threading.Thread(target=run).start()
    return jsonify({"task_id": tid})


@app.route("/full-report", methods=["POST"])
def full_report():
    user, err = require_auth()
    if err: return err
    audio = request.files.get("audio")
    if not audio: return jsonify({"error": "No audio"}), 400
    tid = str(uuid.uuid4())
    ext = os.path.splitext(audio.filename)[1] or ".wav"
    fp  = os.path.join(UPLOAD_FOLDER, f"report_{tid}{ext}")
    audio.save(fp); fname = audio.filename
    tasks[tid] = {
        "status": "queued",
        "stage": "queued",
        "result": None,
        "created_at": datetime.now().isoformat(),
    }
    _start_task_timeout_watchdog(tid, FULL_REPORT_TIMEOUT_SEC)
    def run():
        try:
            tasks[tid]["status"] = "processing"
            tasks[tid]["stage"] = "transcribing"
            tasks[tid]["result"] = process_full_report(fp, fname, user)
            tasks[tid]["stage"] = "finalizing"
            tasks[tid]["status"] = "completed"
            tasks[tid]["completed_at"] = datetime.now().isoformat()
        except Exception as e: tasks[tid].update({"status":"error","stage":"failed","error":str(e)})
        finally:
            if os.path.exists(fp): os.remove(fp)
    threading.Thread(target=run, daemon=True).start()
    return jsonify({"task_id": tid})


@app.route("/download-docx", methods=["POST"])
def download_docx():
    _, err = require_auth()
    if err: return err
    payload = request.get_json()
    if not payload: return jsonify({"error": "No data"}), 400
    try:
        cache_key = _payload_cache_key(payload)
        out_path = build_docx(payload, cache_key=cache_key)
        fname = (payload.get("filename") or "meeting_report").replace(" ","_") + ".docx"
        return send_file(out_path, as_attachment=True, download_name=fname,
                         mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    except Exception as e:
        import traceback
        print("DOCX ERROR:", traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route("/download-pdf", methods=["POST"])
def download_pdf():
    _, err = require_auth()
    if err: return err
    payload = request.get_json()
    if not payload: return jsonify({"error": "No data"}), 400
    
    try:
        # Fast path: try to get cached PDF if it exists
        cache_key = _payload_cache_key(payload)
        pdf_path = os.path.join(CACHE_DIR, f"{cache_key}.pdf")
        
        if os.path.exists(pdf_path):
            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
        else:
            # Generate PDF with timeout — if it takes too long, return DOCX instead
            try:
                pdf_bytes = build_pdf_from_docx(payload)
            except Exception as pdf_err:
                # Fallback: return DOCX if PDF conversion fails or is very slow
                print(f"PDF generation failed, returning DOCX instead: {pdf_err}")
                out_path = build_docx(payload, cache_key=cache_key)
                with open(out_path, "rb") as f:
                    docx_bytes = f.read()
                fname = (payload.get("filename") or "meeting_report").replace(" ","_") + ".docx"
                return send_file(
                    io.BytesIO(docx_bytes),
                    as_attachment=True,
                    download_name=fname,
                    mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                )
        
        fname = (payload.get("filename") or "meeting_report").replace(" ", "_") + ".pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            as_attachment=True,
            download_name=fname,
            mimetype="application/pdf"
        )
    except Exception as e:
        import traceback
        print("PDF ERROR:", traceback.format_exc())
        # Final fallback: serve DOCX
        try:
            payload_copy = dict(payload)
            cache_key = _payload_cache_key(payload_copy)
            out_path = build_docx(payload_copy, cache_key=cache_key)
            with open(out_path, "rb") as f:
                docx_bytes = f.read()
            fname = (payload.get("filename") or "meeting_report").replace(" ","_") + ".docx"
            return send_file(
                io.BytesIO(docx_bytes),
                as_attachment=True,
                download_name=fname,
                mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            )
        except Exception as fallback_err:
            print("FALLBACK ERROR:", fallback_err)
            return jsonify({"error": "Report generation failed. Please try again."}), 500


@app.route("/test-docx")
def test_docx():
    import shutil
    node_path    = shutil.which("node")
    script_exists = os.path.exists(REPORT_SCRIPT)
    test_payload = {
        "filename":"Test Meeting","meeting_date":"Today","meeting_time":"Now",
        "summary":"Test.","transcript":"Test.",
        "segments":[],"attendees":[],"agendas":[],"key_decisions":[],
        "key_highlights":[],"action_items":[],"topics":[],"stats":{}
    }
    try:
        out = build_docx(test_payload)
        ok  = os.path.exists(out)
        if ok: os.remove(out)
        return jsonify({"node_path":node_path,"script_exists":script_exists,"status":"OK"})
    except Exception as e:
        import traceback
        return jsonify({"node_path":node_path,"script_exists":script_exists,
                        "error":str(e),"detail":traceback.format_exc()}), 500


@app.route("/llm-health")
def get_llm_health():
    health = llm_health()
    code = 200
    if health.get("enabled") and not health.get("reachable"):
        code = 503
    return jsonify(health), code


# ══════════════════════════════════════
#  HISTORY ROUTES (per-user)
# ══════════════════════════════════════
@app.route("/history")
def get_history():
    user, err = require_auth()
    if err: return err
    return jsonify(load_history(user))


@app.route("/history/<eid>", methods=["DELETE"])
def del_history(eid):
    user, err = require_auth()
    if err: return err
    h = [x for x in load_history(user) if x.get("id") != eid]
    with open(history_path(user), "w", encoding="utf-8") as f:
        json.dump(h, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True})


@app.route("/history", methods=["DELETE"])
def clear_history():
    user, err = require_auth()
    if err: return err
    with open(history_path(user), "w", encoding="utf-8") as f:
        json.dump([], f)
    return jsonify({"ok": True})


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"]      = request.headers.get("Origin","http://localhost:3000")
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"]     = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"]     = "GET, POST, DELETE, OPTIONS"
    return response

if __name__ == "__main__":
    app.run(debug=True)