"""Draw the stratified, shuffled teacher-labeling sample (text only, source hidden).

Usage: python3 -I make_label_sample.py <corpus.parquet> <out_dir> [seed]
"""
import re
import sys

import numpy as np
import pandas as pd

corpus, outdir = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20261030
rng = np.random.default_rng(seed)
df = pd.read_parquet(corpus)


def display_text(r):
    if r["platform"] == "WhiteHouse.gov":
        words = (r["text"] or "").split()
        return f"{r['title']} — {' '.join(words[:90])}{'…' if len(words) > 90 else ''}"
    t = r["text"]
    return t if len(t) <= 700 else t[:700] + "…"


df["display"] = df.apply(display_text, axis=1)
bare = df["display"].str.replace(r"https?://\S+", "", regex=True).str.strip()
ok = (~df["is_repost"]) & (bare.str.split().str.len() >= 4)
df = df[ok].copy()
df["year"] = df["created_at"].dt.year


def strat(d, n, by="year"):
    """Equal allocation across strata, topped up proportionally where a stratum is small."""
    groups = list(d.groupby(by))
    per = max(1, n // len(groups))
    picks = [g.sample(min(per, len(g)), random_state=int(rng.integers(1e9))) for _, g in groups]
    got = pd.concat(picks)
    if len(got) < n:
        rest = d.drop(got.index)
        got = pd.concat([got, rest.sample(min(n - len(got), len(rest)), random_state=int(rng.integers(1e9)))])
    return got.head(n)


plan = [
    (df[(df.account == "@realDonaldTrump") & (df.role == "Trump out of office")], 220, "year"),
    (df[(df.account == "@realDonaldTrump") & (df.role == "President (personal voice)")], 300, "year"),
    (df[(df.account == "@realDonaldTrump (Truth Social)") & (df.role == "Trump out of office")], 160, "year"),
    (df[(df.account == "@realDonaldTrump (Truth Social)") & (df.role == "President (personal voice)")], 180, "year"),
    (df[df.account == "@StateDept"], 330, "year"),
    (df[df.account == "WhiteHouse.gov"], 130, "wh_category"),
    (df[df.account.isin(["@POTUS", "@WhiteHouse", "@VP"])], 60, "account"),
    (df[df.role == "White House staff (personal)"], 20, "account"),
]
samp = pd.concat([strat(d, n, by) for d, n, by in plan])
samp = samp.sample(frac=1, random_state=seed).reset_index(drop=True)
samp["lid"] = [f"L{i:04d}" for i in range(1, len(samp) + 1)]
samp[["lid", "post_id", "account", "role", "administration", "created_at"]].to_csv(f"{outdir}/label_sample_key.csv", index=False)
samp[["lid", "display"]].to_json(f"{outdir}/label_sample_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(samp), samp.groupby("account").size().to_dict())
