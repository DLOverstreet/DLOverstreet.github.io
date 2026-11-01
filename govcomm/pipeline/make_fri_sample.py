"""Teacher sample for the Fascist Rhetoric Index: 800 posts, stratified by voice group and period,
half random and half selected on earlier text scores (partisan, threatening or leader-centered),
drawn from every account and administration. Text only, shuffled, source hidden.

Usage: python3 -I make_fri_sample.py <scored_posts.parquet> <labels_dir>
"""
import sys

import numpy as np
import pandas as pd

src, outdir = sys.argv[1:3]
rng = np.random.default_rng(1945)
df = pd.read_parquet(src)
df = df[df.analysis_sample].copy()
used = set()
for f in ("label_sample_key.csv", "label_sample2_key.csv"):
    used |= set(pd.read_csv(f"{outdir}/{f}").post_id)
df = df[~df.post_id.isin(used)]
T2 = pd.Timestamp("2025-01-20 17:00", tz="UTC")
t2 = df.created_at >= T2
v = df.voice
strata = {
    "trump_tw_pre": v.eq("Trump · Twitter (private citizen/candidate)"),
    "trump_tw_pres": v.eq("Trump · Twitter (President)"),
    "trump_ts_out": v.eq("Trump · Truth Social (out of office)"),
    "trump_ts_pres": v.isin(["Trump · Truth Social (President)", "Trump · X (President, 2025–)"]),
    "wh_obama": v.eq("@WhiteHouse (all administrations)") & df.administration.eq("Obama"),
    "wh_trump1": (v.eq("@WhiteHouse (all administrations)") | v.eq("@POTUS")) & df.administration.eq("Trump I"),
    "wh_biden": v.eq("@WhiteHouse (all administrations)") & df.administration.eq("Biden"),
    "wh_trump2": (v.isin(["@WhiteHouse (all administrations)", "@POTUS", "@RapidResponse47", "@PressSec", "WhiteHouse.gov"])) & t2,
    "agency_pre": df.account_type.isin(["Agency headquarters", "Agency field office"]) & ~t2,
    "agency_t2": df.account_type.isin(["Agency headquarters", "Agency field office"]) & t2,
    "officials": df.account_type.eq("Official's account"),
}
alloc = {"trump_tw_pre": 60, "trump_tw_pres": 100, "trump_ts_out": 90, "trump_ts_pres": 100, "wh_obama": 40, "wh_trump1": 50,
         "wh_biden": 60, "wh_trump2": 80, "agency_pre": 90, "agency_t2": 80, "officials": 50}
signal = (df.partisanship < -0.4) | (df.threat_hope < -0.4) | (df.personalization < -0.4) | df.villain.isin(["pol", "immig", "media", "legal", "bureau"])
picks = []
for k, n in alloc.items():
    g = df[strata[k]]
    hot = g[signal[g.index]]
    a = hot.sample(min(len(hot), n // 2), random_state=int(rng.integers(1e9)))
    rest = g.drop(a.index)
    b = rest.sample(min(len(rest), n - len(a)), random_state=int(rng.integers(1e9)))
    s = pd.concat([a, b])
    s["stratum"] = k
    s["selected_on_signal"] = s.index.isin(a.index)
    picks.append(s)
samp = pd.concat(picks).drop_duplicates("post_id").sample(frac=1, random_state=11).reset_index(drop=True)
samp["lid"] = [f"F{i:04d}" for i in range(1, len(samp) + 1)]
samp["display"] = [(f"{t} — " if isinstance(t, str) and p == "WhiteHouse.gov" else "") + (x if len(x) <= 700 else x[:700] + "…")
                   for t, p, x in zip(samp.title, samp.platform, samp.text)]
samp[["lid", "post_id", "voice", "administration", "stratum", "selected_on_signal"]].to_csv(f"{outdir}/fri_sample_key.csv", index=False)
samp[["lid", "display"]].to_json(f"{outdir}/fri_sample_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(samp), samp.stratum.value_counts().to_dict())
