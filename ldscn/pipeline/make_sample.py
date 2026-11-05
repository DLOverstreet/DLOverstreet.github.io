"""Teacher sample for the Christian nationalism codes: 450 passages stratified by era; in each era about
65% drawn from passages mentioning the nation or government (probability proportional to the number of
such terms) and 35% at random. Shown blind to speaker, date and source, shuffled.

Usage: python3 -I make_sample.py <chunks.parquet> <labels_dir>
"""
import sys

import numpy as np
import pandas as pd

src, out = sys.argv[1:3]
rng = np.random.default_rng(1776)
ch = pd.read_parquet(src)
ch = ch[~ch.procedural].copy()
ch["era"] = pd.cut(ch.year, [1830, 1869, 1886, 1970, 1989, 2009, 2026],
                   labels=["1850-69", "1870-86", "CR 1880/1897/1970", "1971-89", "1990-2009", "2010-26"])
ch.loc[ch.source.eq("Conference Report"), "era"] = "CR 1880/1897/1970"
TERMS = r"\bamerica|united states|\bnation\b|\bnations\b|constitution|government|\bcountry\b|congress|christian|\bliberty\b|\blaws?\b|patriot|\bflag\b|founding|freedom"
ch["kw"] = ch.text.str.lower().str.count(TERMS)
alloc = {"1850-69": 90, "1870-86": 90, "CR 1880/1897/1970": 30, "1971-89": 85, "1990-2009": 75, "2010-26": 80}
picks = []
for era, n in alloc.items():
    g = ch[ch.era == era]
    hot = g[g.kw >= 2]
    n_hot = int(round(n * 0.65))
    a = hot.sample(n_hot, weights=hot.kw.clip(upper=12), random_state=int(rng.integers(1e9)))
    b = g.drop(a.index).sample(n - n_hot, random_state=int(rng.integers(1e9)))
    picks.append(pd.concat([a.assign(selected_on_signal=True), b.assign(selected_on_signal=False)]).assign(stratum=era))
s = pd.concat(picks).sample(frac=1, random_state=7).reset_index(drop=True)
s["lid"] = [f"C{i:04d}" for i in range(1, len(s) + 1)]
s[["lid", "chunk_id", "talk_id", "stratum", "year", "speaker", "selected_on_signal", "kw"]].to_csv(f"{out}/cn_sample_key.csv", index=False)
s[["lid", "text"]].to_json(f"{out}/cn_sample_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(s), s.stratum.value_counts().to_dict(), "words", s.text.str.split().str.len().sum())
