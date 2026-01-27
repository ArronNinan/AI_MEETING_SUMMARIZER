import re
from collections import Counter

def convert_to_third_person(text):
    replacements = {
        r"\bI\b": "the speaker",
        r"\bwe\b": "the team",
        r"\bWe\b": "The team",
        r"\bour\b": "their",
        r"\bOur\b": "Their",
        r"\bus\b": "them",
        r"\bUs\b": "Them",
        r"\bmy\b": "the speaker's",
        r"\bMy\b": "The speaker's",
        r"\bme\b": "the speaker",
        r"\bMe\b": "The speaker",
        r"\byou\b": "the participants",
        r"\bYou\b": "The participants"
    }

    for pattern, replacement in replacements.items():
        text = re.sub(pattern, replacement, text)

    return text


def summarize_text(text, max_sentences=4):
    # Clean text
    text = re.sub(r"\s+", " ", text)

    sentences = re.split(r'(?<=[.!?]) +', text)

    if len(sentences) <= max_sentences:
        return convert_to_third_person(text)

    # Word frequency
    words = re.findall(r'\w+', text.lower())
    freq = Counter(words)

    # Score sentences
    sentence_scores = {}
    for sentence in sentences:
        for word in re.findall(r'\w+', sentence.lower()):
            sentence_scores[sentence] = sentence_scores.get(sentence, 0) + freq[word]

    # Pick top sentences
    ranked = sorted(sentence_scores, key=sentence_scores.get, reverse=True)
    summary = " ".join(ranked[:max_sentences])

    # 🔹 Convert to third person
    summary = convert_to_third_person(summary)

    return summary
