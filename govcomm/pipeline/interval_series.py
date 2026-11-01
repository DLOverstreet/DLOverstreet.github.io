"""Weekly, monthly, quarterly and yearly series per account, with a post-weighted running average.

Usage: python3 -I interval_series.py <data_dir> <out_dir>
Each row: voice, period (start date), n, the eight scores, and <score>_avg, the mean over all
posts within a centered window (8 weeks, 6 months, 4 quarters; none for years).
"""
import json
import os
import sys

import numpy as np
import pandas as pd

data_dir, out = sys.argv[1:3]
DIMS = ["norms_index", "ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function", "party_slant"]
NORM = ["professionalism", "partisanship", "personalization", "function"]
LABEL = {"Trump · Twitter (private citizen/candidate)": "Trump on Twitter, before office",
         "Trump · Twitter (President)": "Trump on Twitter, as President",
         "Trump · Truth Social (out of office)": "Trump on Truth Social, out of office",
         "Trump · Truth Social (President)": "Trump on Truth Social, as President",
         "@StateDept": "@StateDept", "WhiteHouse.gov": "WhiteHouse.gov",
         "@WhiteHouse (all administrations)": "@WhiteHouse (Obama, Trump I, Biden, Trump II)",
         "@DHSgov": "@DHSgov", "@ICEgov": "@ICEgov", "@CBP": "@CBP", "ICE field offices (ERO, pooled)": "ICE field offices (pooled)",
         "@RapidResponse47": "@RapidResponse47", "@PressSec": "@PressSec"}
# freq, minimum posts per period, running-average window in periods, max gap (days) treated as continuous
SPECS = {"weekly": ("W-SUN", 10, 8), "monthly": ("M", 20, 6), "quarterly": ("Q", 25, 4), "yearly": ("Y", 50, 1)}

df = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"))
df = df[df.analysis_sample & df.voice.isin(LABEL)].copy()
df["norms_index"] = df[NORM].mean(axis=1)
df["voice"] = df.voice.map(LABEL)
tr = df[df.voice.str.startswith("Trump")].copy()
tr["voice"] = "Trump, all personal accounts"
df = pd.concat([df, tr])
df = df[~((df.voice == "@StateDept") & (df.created_at < pd.Timestamp("2012-05-01", tz="UTC")))]
naive = df.created_at.dt.tz_convert(None)

for name, (freq, min_n, win) in SPECS.items():
    df["period"] = naive.dt.to_period(freq).dt.start_time
    rows = []
    for v, g in df.groupby("voice"):
        agg = g.groupby("period")[DIMS].agg(["sum", "count"])
        sums = agg.xs("sum", axis=1, level=1)
        cnt = agg.xs("count", axis=1, level=1)["norms_index"]
        # Reindex onto every period so the window is in calendar time, not in observed rows.
        full = pd.period_range(sums.index.min(), sums.index.max(), freq=freq).start_time
        sums, cnt = sums.reindex(full, fill_value=0), cnt.reindex(full, fill_value=0)
        rs = sums.rolling(win, center=True, min_periods=1).sum()
        rc = cnt.rolling(win, center=True, min_periods=1).sum()
        means = sums.div(cnt.replace(0, np.nan), axis=0)
        avg = rs.div(rc, axis=0)
        keep = cnt >= min_n
        part = means[keep].round(3)
        for d in DIMS:
            part[d + "_avg"] = avg.loc[keep, d].round(3)
        part["n"] = cnt[keep].astype(int)
        part["voice"] = v
        part["period"] = [p.strftime("%Y-%m-%d") for p in part.index]
        rows.append(part.reset_index(drop=True))
    res = pd.concat(rows)[["voice", "period", "n"] + DIMS + [d + "_avg" for d in DIMS]]
    path = os.path.join(out, f"series_{name}.json")
    json.dump(json.loads(res.to_json(orient="records")), open(path, "w"))
    print(f"{name}: {len(res)} rows, {os.path.getsize(path) / 1024:.0f} KB, min n {min_n}, window {win}")
