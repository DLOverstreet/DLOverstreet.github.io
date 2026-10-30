"""Shared text preparation and hand-built features for the student models."""
import gzip
import re

import numpy as np

INSULTS = ("loser|losers|weak|pathetic|dumb|stupid|low iq|lowlife|lunatic|lunatics|crooked|sleepy|crazy|wacky|"
           "disgrace|disgraceful|corrupt|scum|sleazebag|slimeball|thug|thugs|moron|idiot|fake news|witch hunt|hoax|"
           "scam|rigged|deranged|incompetent|failing|third rate|nasty|liar|lying|phony|fraud|sick|evil|treason|"
           "traitor|rino|enemy of the people|radical left|do nothing|lamestream|disaster|horrible|terrible|sad!|"
           "newscum|tds|clown|garbage|loony|nut job|lightweight|choke|dopey")
SUPERLATIVES = ("great|greatest|tremendous|incredible|amazing|fantastic|beautiful|record|historic|massive|best|"
                "biggest|perfect|wonderful|unprecedented|like never before|never been|highest")
_ins = re.compile(r"\b(" + INSULTS + r")\b", re.I)
_sup = re.compile(r"\b(" + SUPERLATIVES + r")\b", re.I)
_emoji = re.compile("[\U0001F000-\U0001FAFF☀-➿\U0001F1E6-\U0001F1FF]")
_url = re.compile(r"https?://\S+|\[url\]")
_fps = re.compile(r"\b(i|me|my|mine|myself)\b", re.I)
_fpp = re.compile(r"\b(we|us|our|ours)\b", re.I)


def unit_text(platform, title, text, max_words=90):
    """The text unit that was labeled: whole post, or title plus lede for WhiteHouse.gov items."""
    text = text or ""
    if platform == "WhiteHouse.gov":
        w = text.split()
        return f"{title} — {' '.join(w[:max_words])}"
    return text if len(text) <= 700 else text[:700]


def clean_for_model(t):
    t = _url.sub(" URL ", t)
    t = re.sub(r"@\s?\w+", " @user ", t)
    return re.sub(r"\s+", " ", t).strip()


def style_features(t):
    raw = _url.sub(" ", t)
    letters = [c for c in raw if c.isalpha()]
    n_let = max(len(letters), 1)
    words = raw.split()
    n_w = max(len(words), 1)
    caps_words = sum(1 for w in words if len(w) > 2 and w.isupper())
    title_words = sum(1 for i, w in enumerate(words) if i > 0 and w[:1].isupper() and not w.isupper()
                      and not words[i - 1].endswith((".", "!", "?", ":")))
    return [
        sum(c.isupper() for c in letters) / n_let,
        caps_words / n_w,
        title_words / n_w,
        raw.count("!") / n_w,
        min(raw.count("!"), 10),
        raw.count("?") / n_w,
        len(_emoji.findall(t)),
        t.count("#"),
        len(re.findall(r"@\s?\w+", t)),
        int(bool(_url.search(t))),
        np.log1p(n_w),
        len(_fps.findall(raw)) / n_w,
        len(_fpp.findall(raw)) / n_w,
        len(_ins.findall(raw)),
        len(_sup.findall(raw)) / n_w,
        int(bool(re.search(r"president donald j\.? trump|president djt|\bdjt\b", raw, re.I))),
        int(bool(re.search(r"thank you for your attention to this matter", raw, re.I))),
        int(raw.strip().startswith(('"', "'", "“"))),
        int(bool(re.search(r"by the authority vested in me|proclamation|memorandum for", raw, re.I))),
    ]


STYLE_NAMES = ["upper_ratio", "caps_word_ratio", "midsentence_capitalized", "excl_rate", "excl_count", "q_rate",
               "emoji", "hashtags", "mentions", "has_url", "log_words", "first_person_sing", "first_person_plural",
               "insult_hits", "superlative_rate", "djt_signature", "attention_matter", "starts_quote", "legal_form"]


def load_glove(path, vocab):
    vecs = {}
    with gzip.open(path, "rt", encoding="utf-8", errors="ignore") as f:
        for line in f:
            sp = line.rstrip().split(" ")
            if sp[0] in vocab and len(sp) == 101:
                vecs[sp[0]] = np.asarray(sp[1:], dtype=np.float32)
    return vecs


_tok = re.compile(r"[a-z]+(?:'[a-z]+)?|[#@]\w+|[!?]")


def glove_mean(t, vecs, dim=100):
    toks = [w for w in _tok.findall(t.lower()) if w in vecs]
    if not toks:
        return np.zeros(dim, dtype=np.float32)
    return np.mean([vecs[w] for w in toks], axis=0)
