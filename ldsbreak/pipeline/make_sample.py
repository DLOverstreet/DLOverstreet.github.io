"""Teacher sample for the breakpoint study, shown blind to speaker, date and source, shuffled across topics.

  RACE      every General Conference / Conference Report passage on the race dictionary (1880-2026), plus a random
            70 of the Journal of Discourses race passages (nineteenth-century baseline)
  MINISTER  15 passages per pre-2018 period bin and 30 per post-2018 bin, from passages on the ministering dictionary
  CONTROL   3 passages per topic per period bin, for six control and three spillover topics (primary topic)

Each row carries its stratum size and sample size, so design-based means can be computed.

Usage: python3 -I make_sample.py <topics.parquet> <chunks.parquet> <labels_dir>
"""
import sys

import numpy as np
import pandas as pd

tp, src, out = sys.argv[1:4]
rng = np.random.default_rng(1978)
t = pd.read_parquet(tp)
BINS = [1969, 1977, 1985, 1995, 2005, 2013, 2017, 2021, 2026]
BLAB = ["1970-77", "1978-85", "1986-95", "1996-05", "2006-13", "2014-17", "2018-21", "2022-26"]
modern = t.source.eq("General Conference") | (t.source.eq("Conference Report") & t.year.eq(1970))
t["bin"] = pd.cut(t.year, BINS, labels=BLAB).astype(str)
picks = []

r = t[(t.hits_RACE > 0) & t.source.isin(["General Conference", "Conference Report"])]
picks.append(r.assign(case="RACE", topic="RACE", stratum="RACE-" + r.source.str[:2], N=len(r), n=len(r)))
j = t[(t.hits_RACE > 0) & t.source.eq("Journal of Discourses")]
js = j.sample(70, random_state=int(rng.integers(1e9)))
picks.append(js.assign(case="RACE", topic="RACE", stratum="RACE-JoD", N=len(j), n=70))

m = t[(t.hits_MINISTER > 0) & modern]
for b in BLAB:
    g = m[m.bin == b]
    k = min(len(g), 30 if b in ("2018-21", "2022-26") else 15)
    picks.append(g.sample(k, random_state=int(rng.integers(1e9))).assign(case="MINISTER", topic="MINISTER", stratum="MIN-" + b, N=len(g), n=k))

for top in ["TITHING", "WOW", "SABBATH", "PRAYER", "WELFARE", "CHASTITY", "MISSION", "TEMPLE", "LAMANITE"]:
    c = t[(t.primary == top) & modern]
    for b in BLAB:
        g = c[c.bin == b]
        k = min(len(g), 3)
        if k:
            picks.append(g.sample(k, random_state=int(rng.integers(1e9))).assign(case="CONTROL", topic=top, stratum=f"{top}-{b}", N=len(g), n=k))

s = pd.concat(picks).drop_duplicates("chunk_id").sample(frac=1, random_state=11).reset_index(drop=True)
s["lid"] = [f"B{i:04d}" for i in range(1, len(s) + 1)]
txt = pd.read_parquet(src, columns=["chunk_id", "text"])
s = s.merge(txt, on="chunk_id")
cols = ["lid", "chunk_id", "talk_id", "case", "topic", "stratum", "N", "n", "bin", "year", "date", "source", "rank", "woman", "speaker_n", "topics", "primary"]
s[cols].to_csv(f"{out}/break_sample_key.csv", index=False)
s[["lid", "topic", "text"]].to_json(f"{out}/break_sample_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(s), s.case.value_counts().to_dict(), "words", s.text.str.split().str.len().sum())
print(s.groupby(["topic"]).size().to_dict())
