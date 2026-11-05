"""Assemble LDS general-authority discourses into talk-level and chunk-level tables.

Sources (public GitHub archives):
  aaronshaf/jod                          Journal of Discourses, 1851-1886 (structured JSON)
  oblakeerickson/general_conference_archive  Conference Reports: Apr 1880, Oct 1897, Apr/Oct 1970
  cgood92/general-conference-stats       General Conference, Apr 1971 - Oct 2025 (case2/output/*.json)

Chunks are paragraph-aligned passages of about 300 words (150-450), the unit that is coded and scored.

Usage: python3 -I build_corpus.py <lds sources dir> <out dir>
"""
import glob
import html
import json
import os
import re
import sys

import pandas as pd

src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
talks = []

# ---- Journal of Discourses ----
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"
jod = json.load(open(os.path.join(src, "aaronshaf_jod/data/jod.json")))
for d in jod:
    paras = [html.unescape(re.sub(r"<[^>]+>", " ", p)) for p in re.split(r"</p>", d.get("content") or "")]
    paras = [re.sub(r"\s+", " ", p).strip() for p in paras]
    paras = [p for p in paras if len(p.split()) >= 3]
    date = None
    m = re.search(rf"({MONTHS})\s+(\d{{1,2}}),?\s+(18\d\d)", d.get("subtitle") or "")
    if m:
        date = pd.to_datetime(f"{m.group(1)} {m.group(2)} {m.group(3)}", errors="coerce")
    if (date is None or pd.isna(date)) and d.get("date"):
        date = pd.to_datetime(d["date"][:10], errors="coerce")
    talks.append({"talk_id": f"JD{d['volume']:02d}-{d['start_page']:03d}", "source": "Journal of Discourses", "date": date,
                  "speaker": (d.get("speaker") or "").strip(), "title": (d.get("title") or "").strip(),
                  "where": re.sub(r"\s+", " ", d.get("subtitle") or "").strip(),
                  "cite": f"JD {d['volume']}:{d['start_page']}", "paragraphs": paras})

# ---- Conference Reports 1880, 1897 (OCR text) ----
ocr_fix = lambda s: re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", s)
for conf, date in [("1880_apr", "1880-04-06"), ("1897_oct", "1897-10-04")]:
    for f in sorted(glob.glob(os.path.join(src, "oblakeerickson_general_conference_archive", conf, "*.txt"))):
        raw = ocr_fix(open(f, encoding="utf-8", errors="replace").read())
        lines = raw.strip().split("\n")
        speaker = re.sub(r"[^A-Za-z .']", "", lines[0]).strip().title()
        body = " ".join(l.strip() for l in lines[1:])
        sents = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", body))
        paras, cur = [], []
        for s in sents:  # OCR text has no paragraph breaks: rebuild ~120-word paragraphs on sentence ends
            cur.append(s)
            if sum(len(x.split()) for x in cur) >= 120:
                paras.append(" ".join(cur)); cur = []
        if cur:
            paras.append(" ".join(cur))
        n = os.path.basename(f)[:-4]
        talks.append({"talk_id": f"CR{n}", "source": "Conference Report", "date": pd.Timestamp(date), "speaker": speaker,
                      "title": "", "where": f"General Conference, {conf.replace('_', ' ')}", "cite": f"CR {conf.replace('_', ' ')}",
                      "paragraphs": paras})

# ---- Conference Reports 1970 (markdown) ----
for f in sorted(glob.glob(os.path.join(src, "oblakeerickson_general_conference_archive", "1970_*", "*.md"))):
    raw = open(f, encoding="utf-8").read()
    title = (re.search(r"^# (.+)$", raw, re.M) or [None, ""])[1].strip()
    speaker = (re.search(r"^## (.+)$", raw, re.M) or [None, ""])[1].strip()
    speaker = re.sub(r"^(President|Elder|Bishop|Sister|Brother)\s+", "", speaker)
    base = os.path.basename(f)
    m = re.match(r"(\d{8})", base)
    when = pd.to_datetime(m.group(1)) if m else pd.Timestamp("1970-04-04" if "1970_apr" in f else "1970-10-02")
    body = [l.strip() for l in raw.split("\n") if l.strip() and not l.startswith("#") and not l.startswith("*")]
    talks.append({"talk_id": f"CR{base[:-3]}", "source": "Conference Report", "date": when, "speaker": speaker,
                  "title": title, "where": "General Conference", "cite": f"CR {when:%Y-%m}", "paragraphs": body})

# ---- General Conference 1971-2025 ----
for f in sorted(glob.glob(os.path.join(src, "cgood92_general-conference-stats", "case2", "output", "*.json"))):
    if not re.search(r"\d{4}-\d{2}\.json$", f):
        continue
    for i, t in enumerate(json.load(open(f))):
        paras = [re.sub(r"\s+", " ", p).strip() for p in (t.get("content") or "").split("\n")]
        paras = [p for p in paras if len(p.split()) >= 3]
        talks.append({"talk_id": f"GC{t['year']}-{int(t['month']):02d}-{i:03d}", "source": "General Conference",
                      "date": pd.Timestamp(f"{t['year']}-{int(t['month']):02d}-05"), "speaker": (t.get("speaker") or "").strip(),
                      "title": (t.get("title") or "").strip(), "where": (t.get("session") or "").strip(), "cite": t.get("url", ""),
                      "paragraphs": paras})

df = pd.DataFrame(talks)
df["speaker"] = df.speaker.str.replace(r"^(President|Elder|Bishop|Sister|Brother)\s+", "", regex=True).str.replace(r"\s+", " ", regex=True)
df["year"] = df.date.dt.year
df["text"] = df.paragraphs.map(lambda p: "\n\n".join(p))
df["n_words"] = df.text.str.split().str.len()
df["title"] = df.title.map(html.unescape)
df["procedural"] = df.n_words < 120  # the 1971+ source already omits sustainings and audit reports
df = df[df.n_words > 0].drop_duplicates("talk_id")

# ---- Chunks: paragraph-aligned, ~300 words (150-450) ----
def chunk(paras, target=300, lo=150, hi=450):
    units = []
    for p in paras:  # split very long paragraphs on sentence ends
        w = p.split()
        if len(w) <= hi:
            units.append(p); continue
        cur = []
        for s in re.split(r"(?<=[.!?])\s+", p):
            cur.append(s)
            if sum(len(x.split()) for x in cur) >= target:
                units.append(" ".join(cur)); cur = []
        if cur:
            units.append(" ".join(cur))
    out_, cur = [], []
    for u in units:
        if cur and sum(len(x.split()) for x in cur) + len(u.split()) > hi:
            out_.append(cur); cur = []
        cur.append(u)
        if sum(len(x.split()) for x in cur) >= target:
            out_.append(cur); cur = []
    if cur:
        if out_ and sum(len(x.split()) for x in cur) < lo:
            out_[-1] += cur
        else:
            out_.append(cur)
    return ["\n\n".join(c) for c in out_]

rows = []
for _, t in df.iterrows():
    for k, c in enumerate(chunk(t.paragraphs)):
        rows.append({"chunk_id": f"{t.talk_id}#{k:03d}", "talk_id": t.talk_id, "k": k, "source": t.source, "year": t.year,
                     "date": t.date, "speaker": t.speaker, "procedural": t.procedural, "text": c, "n_words": len(c.split())})
ch = pd.DataFrame(rows)
ch["n_chunks"] = ch.groupby("talk_id").k.transform("size")
df.drop(columns="paragraphs").to_parquet(os.path.join(out, "talks.parquet"), index=False)
ch.to_parquet(os.path.join(out, "chunks.parquet"), index=False)

print(f"talks {len(df):,}  words {df.n_words.sum():,}  chunks {len(ch):,}")
print(df.groupby("source").agg(talks=("talk_id", "size"), first=("year", "min"), last=("year", "max"), words=("n_words", "sum")).to_string())
dec = (df.year // 10 * 10).value_counts().sort_index()
print("talks by decade:", dec.to_dict())
print("missing dates:", int(df.date.isna().sum()), " procedural:", int(df.procedural.sum()))
print("chunk words: median", ch.n_words.median(), "p5", ch.n_words.quantile(.05), "p95", ch.n_words.quantile(.95))
