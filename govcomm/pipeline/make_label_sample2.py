"""Second teacher sample: 300 posts from the agency and White House accounts added in round 2,
stratified by account type and by before/after Jan 20, 2025, spread across accounts. Text only, shuffled.

Usage: python3 -I make_label_sample2.py <corpus.parquet> <labels_dir>
"""
import sys

import numpy as np
import pandas as pd

corpus, outdir = sys.argv[1:3]
rng = np.random.default_rng(2026_11_01)
df = pd.read_parquet(corpus)
df = df[df.source.isin(["vidproject/x", "Transparency47/socials"]) & (df.platform == "Twitter") & ~df.is_repost
        & ~df.account.str.startswith("@realDonaldTrump")].copy()
bare = df.text.str.replace(r"https?://\S+", "", regex=True).str.strip()
df = df[bare.str.split().str.len() >= 4]
df["t2"] = df.created_at >= pd.Timestamp("2025-01-20 17:00", tz="UTC")
plan = [("Agency headquarters", False, 70), ("Agency headquarters", True, 70), ("White House (institutional)", False, 45),
        ("White House (institutional)", True, 50), ("Agency field office", None, 25), ("Official's account", None, 40)]
picks = []
for typ, t2, n in plan:
    g = df[(df.account_type == typ) & ((df.t2 == t2) if t2 is not None else True)]
    accts = g.account.unique()
    per = int(np.ceil(n / len(accts)))
    s = pd.concat([a.sample(min(len(a), per), random_state=int(rng.integers(1e9))) for _, a in g.groupby("account")])
    picks.append(s.sample(min(n, len(s)), random_state=int(rng.integers(1e9))))
samp = pd.concat(picks).drop_duplicates("post_id").sample(frac=1, random_state=7).reset_index(drop=True)
samp["lid"] = [f"N{i:04d}" for i in range(1, len(samp) + 1)]
samp["display"] = samp.text.where(samp.text.str.len() <= 700, samp.text.str[:700] + "…")
samp[["lid", "post_id", "account", "account_type", "administration", "created_at"]].to_csv(f"{outdir}/label_sample2_key.csv", index=False)
samp[["lid", "display"]].to_json(f"{outdir}/label_sample2_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(samp), samp.groupby(["account_type", "t2"]).size().to_dict())
print(samp.account.value_counts().head(30).to_dict())
