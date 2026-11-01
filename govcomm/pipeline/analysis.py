"""Main analyses: descriptives, interrupted time series, within-speaker office effects,
dimension coordination, NPF villains, topic decomposition, engagement, exemplars, dashboard data.

Usage: python3 -I analysis.py <data_dir> <labels_dir> <out_dir>
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy.stats import pearsonr, spearmanr

data_dir, labels_dir, out = sys.argv[1:4]
tab = os.path.join(out, "tables")
os.makedirs(tab, exist_ok=True)
DIMS = ["ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function"]
ALL = DIMS + ["party_slant"]
df = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"))
df = df[df.analysis_sample & ~df.voice.isin(["Staff (before office)"])].copy()
df["month"] = df.created_at.dt.tz_convert(None).dt.to_period("M").dt.to_timestamp()
df["quarter"] = df.created_at.dt.tz_convert(None).dt.to_period("Q").dt.to_timestamp()
res = {}

# A. Descriptives by voice (Table 1 analogue).
rows = []
for v, g in df.groupby("voice"):
    for d in ALL:
        rows.append({"voice": v, "dimension": d, "N": len(g), "mean": g[d].mean(), "sd": g[d].std(),
                     "min": g[d].min(), "max": g[d].max(), "first": g.created_at.min().date(), "last": g.created_at.max().date()})
t1 = pd.DataFrame(rows)
t1.to_csv(os.path.join(tab, "table1_descriptives_by_voice.csv"), index=False)

# B. @StateDept by Secretary of State.
sd = df[df.voice == "@StateDept"].copy()
order = ["Clinton", "Kerry", "Tillerson", "Pompeo", "Blinken", "Rubio"]
sd = sd[sd.created_at >= pd.Timestamp("2012-05-01", tz="UTC")]  # archive is sparse before May 2012
rows = []
for s in order:
    g = sd[sd.secretary_of_state == s]
    for d in ALL:
        m, se = g[d].mean(), g[d].std() / np.sqrt(len(g))
        rows.append({"secretary": s, "dimension": d, "N": len(g), "mean": m, "ci_lo": m - 1.96 * se, "ci_hi": m + 1.96 * se})
pd.DataFrame(rows).to_csv(os.path.join(tab, "statedept_by_secretary.csv"), index=False)

# C. Interrupted time series for @StateDept (monthly means, Newey-West SEs).
sdi = sd[sd.created_at < pd.Timestamp("2025-01-20 17:00", tz="UTC")]  # ITS covers 2012-2025; Trump II is analysed in trump2.py
mon = sdi.groupby("month")[ALL].mean().reset_index()
mon["n"] = sdi.groupby("month").size().values
mon = mon[mon.n >= 15].reset_index(drop=True)
mon["t"] = (mon.month.dt.year - 2012) * 12 + mon.month.dt.month
t17 = (2017 - 2012) * 12 + 2
t21 = (2021 - 2012) * 12 + 2
mon["trump"] = (mon.t >= t17).astype(int)
mon["biden"] = (mon.t >= t21).astype(int)
mon["t_trump"] = np.maximum(0, mon.t - t17)
mon["t_biden"] = np.maximum(0, mon.t - t21)
rows = []
for d in ALL:
    m = smf.ols(f"{d} ~ t + trump + t_trump + biden + t_biden", data=mon).fit(cov_type="HAC", cov_kwds={"maxlags": 6})
    for term in ["trump", "t_trump", "biden", "t_biden", "t"]:
        rows.append({"dimension": d, "term": term, "coef": m.params[term], "se": m.bse[term], "p": m.pvalues[term]})
its = pd.DataFrame(rows)
its.to_csv(os.path.join(tab, "statedept_its.csv"), index=False)
res["statedept_its_months"] = int(len(mon))

# D. Trump within-speaker office effect (same speaker, same platform, in vs out of office), topic fixed effects.
tr = df[df.voice.str.startswith("Trump")].copy()
tw = tr[(tr.platform == "Twitter") & (tr.created_at >= pd.Timestamp("2015-06-16", tz="UTC"))].copy()
tw["office"] = tw.voice.str.contains("President").astype(int)
ts = tr[tr.platform == "Truth Social"].copy()
ts["office"] = ts.voice.str.contains("President").astype(int)
rows = []
for name, g in [("Twitter: candidate (Jun 2015-Jan 2017) vs President (Jan 2017-Jan 2021)", tw),
                ("Truth Social: out of office (2022-Jan 2025) vs President (Jan 2025-Aug 2026)", ts)]:
    g = g.copy()
    g["ym"] = g.month.astype(str)
    for d in ALL:
        raw = smf.ols(f"{d} ~ office", data=g).fit(cov_type="cluster", cov_kwds={"groups": g["ym"]})
        fe = smf.ols(f"{d} ~ office + C(topic)", data=g).fit(cov_type="cluster", cov_kwds={"groups": g["ym"]})
        rows.append({"comparison": name, "dimension": d, "mean_out": g.loc[g.office == 0, d].mean(),
                     "mean_in": g.loc[g.office == 1, d].mean(), "diff_raw": raw.params["office"], "se_raw": raw.bse["office"],
                     "diff_topicFE": fe.params["office"], "se_topicFE": fe.bse["office"], "p_topicFE": fe.pvalues["office"],
                     "N": len(g)})
toff = pd.DataFrame(rows)
toff.to_csv(os.path.join(tab, "trump_office_effect.csv"), index=False)

# E. Coordination / dimensionality: teacher labels (independent judgments) and within-voice student scores.
lab = pd.read_csv(os.path.join(labels_dir, "teacher_labels.csv"))
C = lab[DIMS].corr()
C.to_csv(os.path.join(tab, "teacher_label_correlations.csv"))
ev = np.linalg.eigvalsh(C.values)[::-1]
res["teacher_eigenvalues"] = [round(float(x), 3) for x in ev]
res["teacher_first_factor_share"] = round(float(ev[0] / ev.sum()), 3)
within = []
for v, g in df.groupby("voice"):
    if len(g) < 500:
        continue
    cm = g[DIMS].corr()
    for i, a in enumerate(DIMS):
        for b in DIMS[i + 1:]:
            within.append({"voice": v, "pair": f"{a}~{b}", "r": cm.loc[a, b]})
pd.DataFrame(within).pivot(index="pair", columns="voice", values="r").to_csv(os.path.join(tab, "within_voice_correlations.csv"))

# F. NPF villains by voice-phase.
vil = (df[df.villain_conf > 0].groupby("voice").villain.value_counts(normalize=True).rename("share").reset_index())
vil.to_csv(os.path.join(tab, "villain_shares_by_voice.csv"), index=False)
vy = df[df.voice.str.startswith("Trump") | (df.voice == "@StateDept")].copy()
vy["year"] = vy.created_at.dt.year
vy["grp"] = np.where(vy.voice == "@StateDept", "@StateDept", "Trump (all accounts)")
vt = vy.groupby(["grp", "year"]).villain.value_counts(normalize=True).rename("share").reset_index()
vt.to_csv(os.path.join(tab, "villain_shares_by_year.csv"), index=False)

# G. Shift-share decomposition: how much of a change is topic mix vs within-topic tone.
def decompose(a, b, d):
    wa = a.topic.value_counts(normalize=True); wb = b.topic.value_counts(normalize=True)
    ma = a.groupby("topic")[d].mean(); mb = b.groupby("topic")[d].mean()
    topics = sorted(set(wa.index) | set(wb.index))
    wa, wb = wa.reindex(topics, fill_value=0), wb.reindex(topics, fill_value=0)
    ma = ma.reindex(topics).fillna(a[d].mean()); mb = mb.reindex(topics).fillna(b[d].mean())
    total = b[d].mean() - a[d].mean()
    within_ = float(((wa + wb) / 2 * (mb - ma)).sum())
    comp = float(((wb - wa) * (ma + mb) / 2).sum())
    return total, within_, comp
rows = []
pairs = [("@StateDept: Kerry -> Pompeo", sd[sd.secretary_of_state == "Kerry"], sd[sd.secretary_of_state == "Pompeo"]),
         ("@StateDept: Pompeo -> Blinken", sd[sd.secretary_of_state == "Pompeo"], sd[sd.secretary_of_state == "Blinken"]),
         ("Trump Twitter: 2009-2014 -> President 2017-2020", tr[(tr.platform == "Twitter") & (tr.created_at.dt.year <= 2014)],
          tr[tr.voice == "Trump · Twitter (President)"]),
         ("Trump: Twitter President -> Truth President", tr[tr.voice == "Trump · Twitter (President)"], tr[tr.voice == "Trump · Truth Social (President)"])]
for name, a, b in pairs:
    for d in ALL:
        tot, w, c = decompose(a, b, d)
        rows.append({"comparison": name, "dimension": d, "total_change": tot, "within_topic": w, "composition": c})
pd.DataFrame(rows).to_csv(os.path.join(tab, "shift_share_decomposition.csv"), index=False)

# H. Engagement on Truth Social: is norm-breaking rewarded? (log likes, demeaned within month)
te = df[(df.platform == "Truth Social") & df.engagement.notna() & (df.engagement > 0)].copy()
te["ll"] = np.log1p(te.engagement)
te["ll_dm"] = te.ll - te.groupby("month").ll.transform("mean")
te["lw"] = np.log1p(te.n_words)
rows = []
for d in ALL:
    m = smf.ols(f"ll_dm ~ {d} + lw", data=te).fit(cov_type="cluster", cov_kwds={"groups": te.month.astype(str)})
    rows.append({"dimension": d, "spearman_raw": spearmanr(te[d], te.engagement)[0], "coef_per_unit": m.params[d],
                 "se": m.bse[d], "pct_change_per_0.5": 100 * (np.exp(0.5 * m.params[d]) - 1), "N": len(te)})
pd.DataFrame(rows).to_csv(os.path.join(tab, "truth_engagement.csv"), index=False)
te["prof_q"] = pd.qcut(te.professionalism, 5, labels=["Q1 least", "Q2", "Q3", "Q4", "Q5 most"])
te.groupby("prof_q", observed=True).agg(median_likes=("engagement", "median"), N=("engagement", "size")).to_csv(
    os.path.join(tab, "truth_engagement_by_professionalism_quintile.csv"))

# I. Convergent validity: Claude-trained ideology vs independent Congress party slant.
conv = []
for v, g in df.groupby("voice"):
    if len(g) > 300:
        conv.append({"voice": v, "post_r": pearsonr(g.ideology, g.party_slant)[0], "N": len(g)})
q = df.groupby(["voice", "quarter"]).filter(lambda g: len(g) >= 30).groupby(["voice", "quarter"])[["ideology", "party_slant"]].mean()
conv.append({"voice": "ALL (voice-quarter means)", "post_r": pearsonr(q.ideology, q.party_slant)[0], "N": len(q)})
oof = pd.read_csv(os.path.join(data_dir, "derived", "oof_predictions.csv")).merge(df[["post_id", "party_slant"]], on="post_id")
conv.append({"voice": "Teacher labels vs slant (labeled posts)", "post_r": pearsonr(oof.ideology_teacher, oof.party_slant)[0], "N": len(oof)})
pd.DataFrame(conv).to_csv(os.path.join(tab, "convergent_validity_ideology_vs_slant.csv"), index=False)

# J. Dashboard data: quarterly series (voice x dim), StateDept monthly, exemplars, tables.
series = {}
for v, g in df.groupby("voice"):
    if len(g) < 200:
        continue
    gq = g.groupby("quarter")
    s = gq[ALL].mean()
    s["n"] = gq.size()
    s = s[s.n >= 25]
    series[v] = {"x": [x.strftime("%Y-%m-%d") for x in s.index], "n": s.n.astype(int).tolist(),
                 **{d: [round(float(y), 3) for y in s[d]] for d in ALL}}
mo = {"x": [x.strftime("%Y-%m-%d") for x in mon.month], **{d: [round(float(y), 3) for y in mon[d]] for d in ALL}}
ex = []
pool = df[(df.n_words >= 8) | (df.platform == "WhiteHouse.gov")]
for v, g in pool.groupby("voice"):
    if len(g) < 200:
        continue
    for d in DIMS + ["party_slant"]:
        for side, gg in (("low", g.nsmallest(6, d)), ("high", g.nlargest(6, d))):
            for _, r in gg.iterrows():
                txt = (r["title"] + " — " if isinstance(r["title"], str) else "") + (r["text"] or "")
                ex.append({"voice": v, "dim": d, "side": side, "score": round(float(r[d]), 2),
                           "date": r.created_at.strftime("%Y-%m-%d"), "text": txt[:420], "url": r["url"]})
pd.DataFrame(ex).drop_duplicates(["voice", "dim", "side", "text"]).to_json(os.path.join(out, "exemplars.json"), orient="records", force_ascii=False)
json.dump({"series": series, "statedept_monthly": mo}, open(os.path.join(out, "series.json"), "w"))
json.dump(res, open(os.path.join(out, "results_misc.json"), "w"), indent=1)

pd.set_option("display.width", 220)
print("== ITS (StateDept)\n", its[its.term.isin(["trump", "biden", "t_trump", "t_biden"])].round(4).to_string(index=False))
print("== Trump office effect\n", toff[["comparison", "dimension", "mean_out", "mean_in", "diff_topicFE", "se_topicFE"]].round(3).to_string(index=False))
print("== eigenvalues", res)
print(pd.read_csv(os.path.join(tab, "convergent_validity_ideology_vs_slant.csv")).round(3).to_string(index=False))
print(pd.read_csv(os.path.join(tab, "truth_engagement.csv")).round(3).to_string(index=False))
