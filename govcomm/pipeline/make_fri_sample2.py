"""Second FRI teacher round: 200 posts chosen on the first-pass student scores, to add positives for the
rare markers and to check the highest-scoring government posts (including Democratic administrations)
for false positives. Selection depends only on text-derived scores, so it does not bias E[y|x].

Usage: python3 -I make_fri_sample2.py <scored_posts.parquet> <fri_scores.parquet> <labels_dir>
"""
import sys

import numpy as np
import pandas as pd

src, fri_path, outdir = sys.argv[1:4]
df = pd.read_parquet(src, columns=["post_id", "voice", "administration", "account_type", "analysis_sample", "created_at", "platform", "title", "text"])
df = df[df.analysis_sample].merge(pd.read_parquet(fri_path, columns=["post_id", "fri"]), on="post_id")
used = set()
for f in ("label_sample_key.csv", "label_sample2_key.csv", "fri_sample_key.csv"):
    used |= set(pd.read_csv(f"{outdir}/{f}").post_id)
df = df[~df.post_id.isin(used)]
T2 = pd.Timestamp("2025-01-20 17:00", tz="UTC")
trump = df.voice.str.startswith("Trump")
gov = df.account_type.isin(["White House (institutional)", "Agency headquarters", "Agency field office", "Official's account"]) & ~df.voice.str.startswith(("Trump", "Staff (before"))
t2 = df.created_at >= T2
picks = []


def top(mask, n, name, per=None):
    g = df[mask & ~df.post_id.isin(pd.concat(picks).post_id if picks else [])]
    if per is not None:  # spread across sub-groups so one account cannot fill the quota
        parts = [x.nlargest(int(np.ceil(n / g[per].nunique())), "fri") for _, x in g.groupby(per)]
        s = pd.concat(parts).nlargest(n, "fri")
    else:
        s = g.nlargest(n, "fri")
    picks.append(s.assign(stratum=name))


top(trump, 60, "trump_top", per="voice")
top(gov & t2, 60, "gov_t2_top", per="account_type")
top(gov & ~t2, 40, "gov_pre_top", per="administration")
mid = df[(df.fri >= df.fri.quantile(0.70)) & (df.fri < df.fri.quantile(0.95)) & ~df.post_id.isin(pd.concat(picks).post_id)]
picks.append(mid.sample(40, random_state=7).assign(stratum="mid_random"))
samp = pd.concat(picks).sample(frac=1, random_state=12).reset_index(drop=True)
samp["lid"] = [f"G{i:04d}" for i in range(1, len(samp) + 1)]
samp["selected_on_signal"] = True
samp["display"] = [(f"{t} — " if isinstance(t, str) and p == "WhiteHouse.gov" else "") + (x if len(x) <= 700 else x[:700] + "…")
                   for t, p, x in zip(samp.title, samp.platform, samp.text)]
samp[["lid", "post_id", "voice", "administration", "stratum", "selected_on_signal"]].to_csv(f"{outdir}/fri_sample2_key.csv", index=False)
samp[["lid", "display"]].to_json(f"{outdir}/fri_sample2_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(samp), samp.stratum.value_counts().to_dict())
print(samp.groupby("stratum").fri.describe().round(2))
