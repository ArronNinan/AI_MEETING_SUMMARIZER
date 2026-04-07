import json
import os
import re
from collections import Counter

import requests

# ── Extended stop words ──────────────────────────────
STOP = set("""
a an the and or but in on at to for of with is was are were be been being
have has had do does did will would could should may might shall can
i we you he she they it this that these those my our your his her their its
me us him them what which who how when where why not no yes just also very
so if then when because since although though even while still yet
let get go going going well good great know think like want need
actually basically essentially basically right okay sure things thing
some any all both each every few more most other such only own
same than too very just back after before up down out about into through
during before after above below between each further once here there
when where why how all both each few more most other some such
""".split())

# ── Common domain terms to remove from topic phrases ─
GENERIC_TERMS = {
    'meeting','discuss','discussion','talked','said','mentioned','point',
    'time','today','yesterday','tomorrow','week','month','year','day',
    'think','going','going','know','need','want','make','take','come',
    'look','see','feel','told','tell','talk','say','things','stuff',
    'everyone','somebody','anybody','nobody','people','person','team',
    'speaker','participant','attendee','group','member','company'
}


def _normalize_transcript_text(text: str) -> str:
    """Clean common ASR artifacts so downstream summarization is more readable."""
    if not text:
        return ""

    text = str(text)
    # Normalize spacing early
    text = re.sub(r'\s+', ' ', text).strip()

    # Remove common disfluencies and self-corrections
    text = re.sub(r'\b(uh+|um+|erm+|hmm+)\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\b(i mean|you know|like)\b', '', text, flags=re.IGNORECASE)

    # Collapse repeated single words (e.g., "the the", "to to")
    text = re.sub(r'\b(\w+)(\s+\1\b){1,}', r'\1', text, flags=re.IGNORECASE)

    # Collapse repeated short phrases up to 4 words
    text = re.sub(
        r'\b((?:\w+\s+){1,4}\w+)\s+\1\b',
        r'\1',
        text,
        flags=re.IGNORECASE,
    )

    # Replace generic ASR speaker placeholders with neutral role wording
    text = re.sub(r"\bthe speaker's\b", "the presenter's", text, flags=re.IGNORECASE)
    text = re.sub(r'\bthe speaker\b', 'the presenter', text, flags=re.IGNORECASE)

    # Clean spacing around punctuation
    text = re.sub(r'\s+([,.;:!?])', r'\1', text)
    text = re.sub(r'([,.;:!?])(\w)', r'\1 \2', text)
    text = re.sub(r'\s{2,}', ' ', text).strip()
    return text


def _sentences(text):
    """Split into clean sentences of at least 15 chars."""
    text = _normalize_transcript_text(text)
    parts = re.split(r'(?<=[.!?])\s+', text)
    return [s.strip() for s in parts if len(s.strip()) >= 15]


def _clean_sentence(s):
    """Remove filler phrases and make more formal."""
    s = re.sub(r"^(so|well|okay|right|yeah|i think|i mean|you know|basically|actually)[,\s]+", '', s, flags=re.IGNORECASE)
    s = re.sub(r'\bi\b', 'the speaker', s, flags=re.IGNORECASE)
    s = re.sub(r'\bwe\b', 'the team',   s, flags=re.IGNORECASE)
    s = re.sub(r'\byou\b', 'the team',  s, flags=re.IGNORECASE)
    s = re.sub(r'\s{2,}', ' ',   s)
    # Capitalise first letter
    return s.strip().capitalize() if s.strip() else s


def _formalize(s):
    """Convert extracted sentence to formal business language."""
    # Remove filler and informal beginning
    s = _clean_sentence(s)
    if not s:
        return s
    
    # Convert common informal patterns to formal equivalents
    replacements = [
        (r'\b(?:need to|gotta|gonna|wanna)\b', 'should'),
        (r'\bsaid\b', 'stated'),
        (r'\btold\b', 'informed'),
        (r'\btalk(?:ed|ing)?\b', 'discuss'),
        (r"\bcan't\b", 'cannot'),
        (r"\bwon't\b", 'will not'),
        (r"\bdon't\b", 'do not'),
        (r"\bdoesn't\b", 'does not'),
        (r"\bdidn't\b", 'did not'),
        (r"\bit's\b", 'it is'),
        (r"\bthat's\b", 'that is'),
        (r"\bthere's\b", 'there is'),
        (r"\bwe're\b", 'we are'),
        (r"\bthey're\b", 'they are'),
        (r'\bdiscussed?\s+about\b', 'discussed'),
        (r'\bstuff\b', 'items'),
        (r'\bthings\b', 'matters'),
        (r'\bbig\s+thing\b', 'primary matter'),
        (r'\bbig\s+rock\b', 'major priority'),
        (r'\bquick\s+question\b', 'clarification request'),
        (r'\b(?:kinda|sorta|rather|quite)\s+', ''),
        (r'\b(?:really|very|extremely|incredibly)\s+', ''),
        (r',?\s*right\?$', '.'),
        (r',?\s*okay\?$', '.'),
        (r',?\s*yeah\?$', '.'),
        (r'\?\s*$', '.'),  # Replace trailing questions with periods for statements
        (r'_+', ''),  # Remove underscores
        (r'\bparticipants\b', 'participants'),
        (r'\bpresenter\b', 'facilitator'),
    ]
    
    for old, new in replacements:
        s = re.sub(old, new, s, flags=re.IGNORECASE)
    
    # Clean up extra spaces and ensure single periods
    s = re.sub(r'\s{2,}', ' ', s)
    s = re.sub(r'\.{2,}', '.', s)
    s = s.rstrip(',;:')
    
    # Ensure period at end if missing
    if s and not s.endswith(('.', '!', '?')):
        s += '.'

    # Normalize punctuation and enforce formal sentence casing.
    s = re.sub(r'\s{2,}', ' ', s).strip()
    if s:
        s = s[0].upper() + s[1:]
    
    return s.strip()


def _is_low_quality_sentence(s: str) -> bool:
    """Filter sentences that are likely noise from rough transcripts."""
    if not s:
        return True
    s = s.strip()
    if len(s) < 25:
        return True

    # Too many repeated tokens usually means garbled ASR output.
    tokens = re.findall(r"[A-Za-z']+", s.lower())
    if not tokens:
        return True
    uniq_ratio = len(set(tokens)) / max(1, len(tokens))
    if len(tokens) >= 10 and uniq_ratio < 0.45:
        return True

    # Skip obvious conversational noise not useful for report sections.
    noise_patterns = [
        r'\b(thank you|thanks everybody|have a great day)\b',
        r'\b(can you hear me|you are on mute)\b',
        r'\b(hello|hi everyone)\b',
    ]
    for pat in noise_patterns:
        if re.search(pat, s, flags=re.IGNORECASE):
            return True
    return False


def _dedupe_items(items, max_items=8):
    """Keep unique lines by normalized fingerprint while preserving order."""
    out = []
    seen = set()
    for item in items:
        txt = str(item).strip()
        if not txt:
            continue
        key = re.sub(r'[^a-z0-9]+', ' ', txt.lower()).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(txt)
        if len(out) >= max_items:
            break
    return out


def _formalize_list(items, max_items=8):
    """Normalize list items to formal sentence style with dedupe and stable order."""
    out = []
    for item in items or []:
        txt = _formalize(str(item).strip())
        if not txt:
            continue
        out.append(txt)
        if len(out) >= max_items:
            break
    return _dedupe_items(out, max_items=max_items)


def _score(sentence, keywords):
    s = sentence.lower()
    return sum(1 for kw in keywords if kw in s)


def _top(sentences, keywords, n=5):
    """Extract top sentences matching keywords. Optimized with fast filtering."""
    # Fast pre-filter: only score sentences containing at least one keyword
    keyword_set = set(keywords)
    candidates = []
    
    for s in sentences:
        if _is_low_quality_sentence(s):
            continue
        s_lower = s.lower()
        # Quick substring check before full scoring
        if any(kw in s_lower for kw in keyword_set):
            score = _score(s, keyword_set)
            if score > 0:
                candidates.append((s, score))
    
    if not candidates:
        return []
    
    # Sort by score and take top n
    candidates.sort(key=lambda x: x[1], reverse=True)
    results = []
    for s, _ in candidates[:n]:
        formalized = _formalize(s)
        if formalized:
            results.append(formalized)
    return _dedupe_items(results, max_items=n)


# ── Keywords ─────────────────────────────────────────
DECISION_KW = [
    'decided', 'agreed', 'confirmed', 'resolved', 'approved',
    'finalized', 'concluded', 'determined', 'voted', 'accepted',
    'rejected', 'deferred', 'moved forward', 'signed off', 'authorised',
    'will proceed', 'go ahead', 'final decision'
]

HIGHLIGHT_KW = [
    'important', 'significant', 'key', 'major', 'critical', 'noted',
    'highlighted', 'emphasized', 'notable', 'achievement', 'success',
    'concern', 'issue', 'risk', 'opportunity', 'milestone', 'update',
    'progress', 'result', 'outcome', 'performance', 'target', 'goal'
]

ACTION_KW = [
    'will', 'should', 'need to', 'must', 'action', 'follow up',
    'follow-up', 'assigned', 'responsible', 'deadline', 'by friday',
    'by monday', 'by end of', 'next week', 'next meeting', 'to do',
    'schedule', 'prepare', 'submit', 'send', 'complete', 'review',
    'create', 'update', 'present', 'arrange', 'coordinate'
]

ACTION_START_VERBS = {
    'assign', 'arrange', 'build', 'check', 'clarify', 'close', 'complete',
    'confirm', 'coordinate', 'create', 'deliver', 'document', 'draft',
    'escalate', 'finalize', 'follow', 'prepare', 'provide', 'publish',
    'review', 'schedule', 'send', 'share', 'submit', 'track', 'update',
    'validate'
}

AGENDA_KW = [
    'agenda', 'discuss', 'review', 'update', 'plan', 'proposal',
    'report', 'presentation', 'status', 'overview', 'topic',
    'introduce', 'cover', 'address', 'consider', 'evaluate',
    'assessment', 'analysis', 'strategy', 'objective', 'goal'
]

# Topic indicator phrases — these signal a topic change/subject
TOPIC_SIGNALS = [
    r'\bregarding\b', r'\babout\b', r'\bconcerning\b', r'\brelated to\b',
    r'\bon the topic of\b', r'\bwith respect to\b', r'\bin terms of\b',
    r'\bthe (project|budget|team|product|client|schedule|timeline|roadmap|plan|strategy|launch|release|feature|system|platform|process|policy|contract|proposal|report)\b',
]


def _extract_topics(sentences, text):
    """
    Extract actual discussion topics from sentences — not word frequency.
    Looks for noun phrases around subject-indicator patterns.
    Optimized for speed on large documents.
    """
    topics_found = []
    seen = set()

    # Use simpler pattern for speed — most relevant topics appear early
    if len(sentences) > 50:
        # For long documents, sample every nth sentence to reduce processing time
        sample_rate = max(1, len(sentences) // 30)
        sentences_to_check = sentences[::sample_rate]
    else:
        sentences_to_check = sentences

    # Single simpler pattern that works well
    simple_pattern = r'(?:discussed?|talked? about|review|address|present|agenda.*?on|regarding|about)\s+(?:the\s+)?([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+){0,3})'

    for sent in sentences_to_check:
        sl = sent.lower()
        # Fast substring check before regex
        if not any(kw in sl for kw in ['discuss', 'review', 'address', 'present', 'agenda', 'regarding', 'about']):
            continue
        
        matches = re.findall(simple_pattern, sl, re.IGNORECASE)
        for m in matches:
            phrase = m.strip()
            if len(phrase) < 3 or len(phrase) > 50:
                continue
            if phrase.lower() in STOP | GENERIC_TERMS:
                continue
            phrase = phrase.title()
            if phrase not in seen and len(phrase) > 4:
                seen.add(phrase)
                topics_found.append(phrase)
            if len(topics_found) >= 12:  # Early exit
                break
        if len(topics_found) >= 12:
            break

    # Limit to 8 most relevant topics
    unique = list(dict.fromkeys(topics_found[:12]))[:8]

    # If we found topics, assign % coverage evenly
    if unique:
        base = 100 // len(unique)
        rem  = 100 - base * len(unique)
        return [{'topic': t, 'duration_pct': base + (1 if i < rem else 0)}
                for i, t in enumerate(unique)]

    # Fallback: extract capitalized noun phrases quickly
    fallback = []
    words = re.findall(r'\b[A-Z][a-z]+\b', text)
    freq = Counter(w for w in words if w.lower() not in STOP | GENERIC_TERMS)
    
    for word, _ in freq.most_common(6):
        fallback.append({'topic': word, 'duration_pct': round(100/min(6, len(freq.most_common(6))))})
    return fallback[:6]


def summarize_text(text, max_sentences=5):
    """Extractive summary — picks most informative sentences. Fast version."""
    text = _normalize_transcript_text(text)
    sentences = _sentences(text)
    if not sentences:
        return text[:500] if len(text) > 500 else text

    # Fast summary: sample sentences if document is very long
    if len(sentences) > 200:
        # Process only first 200 sentences for speed
        sentences_to_score = sentences[:200]
    else:
        sentences_to_score = sentences

    words = re.findall(r'\w+', text.lower())
    freq  = Counter(w for w in words if w not in STOP and len(w) > 3)

    scored = {}
    for s in sentences_to_score:
        if _is_low_quality_sentence(s):
            continue
        score = sum(freq.get(w, 0) for w in re.findall(r'\w+', s.lower())
                    if w not in STOP and len(w) > 3)
        # Boost sentences with decision/highlight keywords
        score += _score(s, DECISION_KW)  * 3
        score += _score(s, HIGHLIGHT_KW) * 2
        scored[s] = score

    ranked  = sorted(scored, key=scored.get, reverse=True)
    chosen  = ranked[:max_sentences]
    # Keep original order
    ordered = [s for s in sentences if s in chosen and not _is_low_quality_sentence(s)]
    cleaned = [_formalize(s) for s in ordered if _formalize(s)]
    cleaned = _dedupe_items(cleaned, max_items=max_sentences)
    if not cleaned:
        return "The meeting covered operational updates, decisions, and defined follow-up actions requiring coordination across the participating teams."
    return ' '.join(cleaned)


def _as_action_items(value, max_items=8):
    """Normalize action items to object form expected by report generator."""

    def _normalize_action_task(task: str) -> str:
        t = _formalize(task)
        if not t:
            return ""

        # Strip conversational/opening fragments to keep imperative style.
        t = re.sub(r'^(the\s+team|team|participants?)\s+(should|will|must|need\s+to)\s+', '', t, flags=re.IGNORECASE)
        t = re.sub(r'^(it\s+was\s+agreed\s+to|agreed\s+to)\s+', '', t, flags=re.IGNORECASE)
        t = re.sub(r'^(there\s+is\s+a\s+need\s+to)\s+', '', t, flags=re.IGNORECASE)
        t = re.sub(r'\s{2,}', ' ', t).strip()

        if not t:
            return ""

        # Ensure action items begin with an action verb for report readability.
        first = re.findall(r"[A-Za-z']+", t.lower())
        if first and first[0] in ACTION_START_VERBS:
            t = t[0].upper() + t[1:]
        else:
            t = f"Complete {t[0].lower() + t[1:] if len(t) > 1 else t.lower()}"

        if not t.endswith('.'):
            t += '.'
        return t

    if not isinstance(value, list):
        return []

    out = []
    for item in value:
        if isinstance(item, dict):
            task = str(item.get('item', '')).strip()
            owner = str(item.get('owner', 'TBD')).strip() or 'TBD'
            if not task:
                continue
            # Keep action phrasing explicit and formal in fallback mode.
            normalized_task = _normalize_action_task(task)
            if not normalized_task:
                continue
            out.append({'item': normalized_task, 'owner': owner.title() if owner != 'TBD' else owner})
        else:
            task = _normalize_action_task(str(item).strip())
            if not task:
                continue
            out.append({'item': task, 'owner': 'TBD'})

        if len(out) >= max_items:
            break

    # Deduplicate by item text
    deduped = []
    seen = set()
    for rec in out:
        key = re.sub(r'[^a-z0-9]+', ' ', rec.get('item', '').lower()).strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(rec)
    return deduped[:max_items]


def extract_sections(text):
    """
    Extract all report sections from transcript text.
    Returns formal, first-person-free content ready for the Word report.
    Optimized for performance on large documents.
    """
    text      = _normalize_transcript_text(text)
    sentences = _sentences(text)
    
    if not sentences:
        return {
            'agendas': [],
            'key_decisions': [],
            'key_highlights': [],
            'action_items': [],
            'topics': [],
            'stats': {'total_words': len(text.split())},
        }
    
    # Single pass: compute word frequency once
    words = re.findall(r'\w+', text.lower())
    total_words = len(words)
    
    # Fast scoring: only check sentences that likely contain keywords
    agendas        = _formalize_list(_top(sentences, AGENDA_KW,    5), max_items=5)
    key_decisions  = _formalize_list(_top(sentences, DECISION_KW,  6), max_items=6)
    key_highlights = _formalize_list(_top(sentences, HIGHLIGHT_KW, 6), max_items=6)
    raw_action_items = _top(sentences, ACTION_KW, 6)
    action_items = _as_action_items(raw_action_items, max_items=6)
    
    # For long documents, skip topic extraction to save time
    # User can request more detailed analysis if needed
    if len(sentences) > 100:
        topics = []
    else:
        topics = _extract_topics(sentences, text)

    # Ensure report sections remain meaningful even when keyword extraction is sparse.
    if not agendas and topics:
        agendas = _formalize_list([f"Reviewed {t.get('topic', 'key topics')} updates" for t in topics[:4]], max_items=4)

    if not key_highlights and agendas:
        key_highlights = _formalize_list(agendas[:4], max_items=4)

    if not key_decisions and key_highlights:
        key_decisions = _formalize_list([
            f"The team aligned on {h.rstrip('.') .lower()}" for h in key_highlights[:3]
        ], max_items=3)

    return {
        'agendas':        agendas,
        'key_decisions':  key_decisions,
        'key_highlights': key_highlights,
        'action_items':   action_items,
        'topics':         topics,
        'stats':          {'total_words': total_words},
    }


def _llm_mode() -> str:
    """
    Supported values:
      - true/on/1: always attempt LLM
      - false/off/0: never use LLM
      - auto (default): use LLM only when local service is reachable
    """
    return os.getenv('USE_GENERATIVE_SUMMARY', 'auto').strip().lower()


def _llm_enabled() -> bool:
    mode = _llm_mode()
    return mode in {'1', 'true', 'yes', 'on', 'auto'}


def _ollama_base_url() -> str:
    url = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434/api/chat').strip()
    return url.rsplit('/api/', 1)[0] if '/api/' in url else url.rstrip('/')


def _llm_auto_ready() -> bool:
    """Fast readiness check used by auto mode to prevent long timeouts."""
    base = _ollama_base_url()
    model = os.getenv('GENERATIVE_MODEL', 'llama3.2:1b').strip()
    try:
        resp = requests.get(f"{base}/api/tags", timeout=2)
        if not resp.ok:
            return False
        payload = resp.json() if resp.content else {}
        models = [m.get('name') for m in payload.get('models', []) if isinstance(m, dict) and m.get('name')]
        if not models:
            return False
        return model in models
    except Exception:
        return False


def _extract_first_json_object(raw: str):
    """Extract first balanced JSON object from model output text."""
    start = raw.find('{')
    if start < 0:
        return None

    depth = 0
    for i in range(start, len(raw)):
        ch = raw[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                snippet = raw[start:i + 1]
                try:
                    return json.loads(snippet)
                except Exception:
                    return None
    return None


def _as_str_list(value, max_items=8):
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        txt = str(item).strip()
        if txt:
            out.append(txt)
        if len(out) >= max_items:
            break
    return out


def _as_topics(value, max_items=8):
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if isinstance(item, dict):
            topic = str(item.get('topic', '')).strip()
            pct = item.get('duration_pct')
        else:
            topic = str(item).strip()
            pct = None

        if not topic:
            continue

        rec = {'topic': topic}
        if isinstance(pct, (int, float)):
            rec['duration_pct'] = max(0, min(100, int(round(pct))))
        out.append(rec)
        if len(out) >= max_items:
            break
    return out


def _call_local_llm(prompt: str, timeout_sec: int | None = None):
    """
    Call an Ollama-compatible chat endpoint.
    Defaults:
      OLLAMA_URL=http://127.0.0.1:11434/api/chat
      GENERATIVE_MODEL=llama3.1:8b
    """
    url = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434/api/chat').strip()
    model = os.getenv('GENERATIVE_MODEL', 'llama3.2:1b').strip()
    default_timeout = int(os.getenv('GENERATIVE_TIMEOUT_SEC', '40').strip() or '40')
    timeout_sec = int(timeout_sec if timeout_sec is not None else default_timeout)

    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': 'You are an expert meeting analyst. Return strict JSON only.'},
            {'role': 'user', 'content': prompt},
        ],
        'stream': False,
        'options': {'temperature': 0.2},
    }

    resp = requests.post(url, json=payload, timeout=timeout_sec)
    resp.raise_for_status()
    data = resp.json()
    return (data.get('message') or {}).get('content', '')


def generate_llm_summary_and_sections(text, timeout_sec: int | None = None):
    """
    Optional generative summary/sections.
    Returns None when disabled or on failure.
    """
    text = _normalize_transcript_text(text)
    if not text or not _llm_enabled():
        return None

    if _llm_mode() == 'auto' and not _llm_auto_ready():
        return None

    total_words = len(re.findall(r'\w+', text.lower()))
    clipped = text[:18000]  # keep request bounded for local models

    prompt = f"""
Analyze this meeting transcript and return ONLY valid JSON.

JSON schema:
{{
    "summary": "string (4-8 sentences, executive and cohesive)",
    "agendas": ["string"],
    "key_decisions": ["string"],
    "key_highlights": ["string"],
    "action_items": [{{"item":"string","owner":"string"}}],
  "topics": [{{"topic": "string", "duration_pct": number}}]
}}

Rules:
- Do not include markdown.
- Write polished formal business language suitable for executive reporting.
- Do not copy raw spoken lines verbatim; rewrite for clarity.
- Use third-person wording and remove filler/disfluencies.
- Avoid conversational phrases, slang, and contractions.
- Keep lists concise, specific, and factual.
- If owner is unknown, set owner to "TBD".
- If data is missing, return empty arrays.

Transcript:
{clipped}
""".strip()

    try:
        raw = _call_local_llm(prompt, timeout_sec=timeout_sec)
        parsed = _extract_first_json_object(raw)
        if not isinstance(parsed, dict):
            return None

        summary = str(parsed.get('summary', '')).strip()
        if not summary:
            return None

        return {
            'summary': _formalize(summary),
            'agendas': _dedupe_items(_as_str_list(parsed.get('agendas'), max_items=6), max_items=6),
            'key_decisions': _dedupe_items(_as_str_list(parsed.get('key_decisions'), max_items=8), max_items=8),
            'key_highlights': _dedupe_items(_as_str_list(parsed.get('key_highlights'), max_items=8), max_items=8),
            'action_items': _as_action_items(parsed.get('action_items'), max_items=8),
            'topics': _as_topics(parsed.get('topics'), max_items=8),
            'stats': {'total_words': total_words},
        }
    except Exception:
        return None


def summarize_and_extract(text, allow_llm=True, llm_timeout_sec: int | None = None, return_meta: bool = False):
    """
    Unified entrypoint:
    - Uses local generative model if USE_GENERATIVE_SUMMARY=true and model is reachable.
    - Falls back to existing extractive summary + heuristic sections.
    """
    llm_result = generate_llm_summary_and_sections(text, timeout_sec=llm_timeout_sec) if allow_llm else None
    if llm_result:
        if return_meta:
            return {**llm_result, "_meta": {"llm_used": True, "mode": "llm"}}
        return llm_result

    sections = extract_sections(text)
    out = {'summary': summarize_text(text), **sections}
    if return_meta:
        out["_meta"] = {"llm_used": False, "mode": "fallback"}
    return out


def llm_health():
    """Return local LLM configuration and reachability status."""
    enabled = _llm_enabled()
    url = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434/api/chat').strip()
    model = os.getenv('GENERATIVE_MODEL', 'llama3.2:1b').strip()
    timeout_sec = int(os.getenv('GENERATIVE_TIMEOUT_SEC', '40').strip() or '40')
    mode = _llm_mode()

    status = {
        'enabled': enabled,
        'mode': mode,
        'provider': 'ollama-compatible',
        'url': url,
        'model': model,
        'timeout_sec': timeout_sec,
        'reachable': False,
    }

    if not enabled:
        status['state'] = 'disabled'
        return status

    base = _ollama_base_url()
    tags_url = f"{base}/api/tags"

    try:
        resp = requests.get(tags_url, timeout=min(timeout_sec, 8))
        if not resp.ok:
            status['state'] = 'unreachable'
            status['error'] = f"HTTP {resp.status_code}"
            return status

        payload = resp.json() if resp.content else {}
        models = [m.get('name') for m in payload.get('models', []) if isinstance(m, dict) and m.get('name')]
        status['reachable'] = True
        status['state'] = 'ok'
        status['available_models'] = models[:20]
        status['model_present'] = model in models if models else False
        return status
    except Exception as e:
        status['state'] = 'unreachable'
        status['error'] = str(e)
        return status