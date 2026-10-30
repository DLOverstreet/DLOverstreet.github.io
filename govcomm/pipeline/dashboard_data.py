"""Write the tidy JSON tables the Official Voice Tracker dashboard reads.

Usage: python3 -I dashboard_data.py <data_dir> <labels_dir> <analysis_dir>
"""
import json
import os
import sys

import numpy as np
import pandas as pd

data_dir, labels_dir, an = sys.argv[1:4]
out = os.path.join(an, "dashboard")
os.makedirs(out, exist_ok=True)
tab = os.path.join(an, "tables")
DIMS = ["ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function"]
NORM = ["professionalism", "partisanship", "personalization", "function"]
LABEL = {"Trump · Twitter (private citizen/candidate)": "Trump on Twitter, before office",
         "Trump · Twitter (President)": "Trump on Twitter, as President",
         "Trump · Truth Social (out of office)": "Trump on Truth Social, out of office",
         "Trump · Truth Social (President)": "Trump on Truth Social, as President",
         "@StateDept": "@StateDept", "WhiteHouse.gov": "WhiteHouse.gov",
         "@POTUS / @WhiteHouse / @VP (2017)": "@POTUS, @WhiteHouse, @VP (early 2017)",
         "Staff accounts": "White House staff accounts (early 2017)"}


def dump(name, rows):
    rows = json.loads(pd.DataFrame(rows).to_json(orient="records", double_precision=4))
    json.dump(rows, open(os.path.join(out, name + ".json"), "w"), ensure_ascii=False)
    print(f"{name}: {len(rows)} rows, {os.path.getsize(os.path.join(out, name + '.json')) / 1024:.1f} KB")


df = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"))
df = df[df.analysis_sample & df.voice.isin(LABEL)].copy()
df["norms_index"] = df[NORM].mean(axis=1)
df["voice"] = df.voice.map(LABEL)
df["quarter"] = df.created_at.dt.tz_convert(None).dt.to_period("Q").dt.start_time.dt.strftime("%Y-%m-%d")
ALL = ["norms_index"] + DIMS + ["party_slant"]

# Quarterly series per voice, plus Trump's personal accounts pooled across platforms and phases.
tr = df[df.voice.str.startswith("Trump")].copy()
tr["voice"] = "Trump, all personal accounts"
q = pd.concat([df, tr]).groupby(["voice", "quarter"])
qs = q[ALL].mean().round(4)
qs["n"] = q.size()
qs = qs[qs.n >= 25].reset_index()
qs = qs[~((qs.voice == "@StateDept") & (qs.quarter < "2012-04-01"))]
dump("quarterly", qs)

vs = df.groupby("voice").agg(n=("post_id", "size"), first=("created_at", "min"), last=("created_at", "max"), **{d: (d, "mean") for d in ALL}).reset_index()
vs["first"] = vs["first"].dt.strftime("%Y-%m-%d")
vs["last"] = vs["last"].dt.strftime("%Y-%m-%d")
dump("voice_summary", vs.round(4))

sd = df[(df.voice == "@StateDept") & (df.created_at >= pd.Timestamp("2012-05-01", tz="UTC"))].copy()
sd["month"] = sd.created_at.dt.tz_convert(None).dt.to_period("M").dt.start_time.dt.strftime("%Y-%m-%d")
m = sd.groupby("month")
ms = m[ALL].mean().round(4)
ms["n"] = m.size()
dump("state_monthly", ms[ms.n >= 15].reset_index())

rows = []
for s in ["Clinton", "Kerry", "Tillerson", "Pompeo", "Blinken"]:
    g = sd[sd.secretary_of_state == s]
    r = {"secretary": s, "n": len(g), "start": g.created_at.min().strftime("%Y-%m-%d"), "end": g.created_at.max().strftime("%Y-%m-%d")}
    for d in ALL:
        se = g[d].std() / np.sqrt(len(g))
        r[d], r[d + "_lo"], r[d + "_hi"] = g[d].mean(), g[d].mean() - 1.96 * se, g[d].mean() + 1.96 * se
    rows.append(r)
dump("state_secretary", pd.DataFrame(rows).round(4))

its = pd.read_csv(os.path.join(tab, "statedept_its.csv"))
its = its[its.term.isin(["trump", "t_trump", "biden", "t_biden"])].copy()
its["term"] = its.term.map({"trump": "Level change, Jan 2017", "t_trump": "Slope change per year, 2017-2020",
                            "biden": "Level change, Jan 2021", "t_biden": "Slope change per year, 2021-2025"})
slope = its.term.str.startswith("Slope")
its.loc[slope, ["coef", "se"]] *= 12
its["key"] = its.dimension + " | " + its.term
dump("state_its", its.round(4))

to = pd.read_csv(os.path.join(tab, "trump_office_effect.csv"))
to["platform"] = np.where(to.comparison.str.startswith("Twitter"), "Twitter", "Truth Social")
to = to.rename(columns={"diff_topicFE": "diff", "se_topicFE": "se", "p_topicFE": "p"})
to["key"] = to.platform + " | " + to.dimension
dump("trump_office", to[["key", "platform", "dimension", "mean_out", "mean_in", "diff", "se", "p", "N"]].round(4))

vil = df[df.villain_conf > 0].groupby("voice").villain.value_counts(normalize=True).rename("share").reset_index()
vil["key"] = vil.voice + " | " + vil.villain
dump("villains", vil.round(4))

te = pd.read_csv(os.path.join(tab, "truth_engagement_by_professionalism_quintile.csv"))
te["quintile"] = te.prof_q.str.replace(" least", " (least professional)").str.replace(" most", " (most professional)")
dump("engagement_quintiles", te[["quintile", "median_likes", "N"]])
em = pd.read_csv(os.path.join(tab, "truth_engagement.csv"))
dump("engagement_model", em[["dimension", "coef_per_unit", "se", "pct_change_per_0.5", "N"]].rename(columns={"pct_change_per_0.5": "pct_change_per_half_point"}).round(4))

wh = df[df.voice == "WhiteHouse.gov"].copy()
wh["category"] = wh.wh_category.str.replace("Actions/2025", "Actions (other)").str.replace("Actions/", "")
g = wh.groupby("category")
whc = g[ALL].mean().round(4)
whc["n"] = g.size()
dump("wh_categories", whc.reset_index().sort_values("norms_index", ascending=False))

lab = pd.read_csv(os.path.join(labels_dir, "teacher_labels.csv"))
cm = lab[DIMS].corr()
dump("teacher_corr", [{"key": f"{a} | {b}", "a": a, "b": b, "r": round(float(cm.loc[a, b]), 3)} for a in DIMS for b in DIMS])

val = pd.read_csv(os.path.join(data_dir, "derived", "validation_dimensions.csv"))
rt = pd.read_csv(os.path.join(labels_dir, "retest_reliability.csv")).set_index("dimension")
val["retest_r"] = val.dimension.map(rt["r"])
dump("validation", val[["dimension", "teacher_sd", "r_ridge", "r_gbm", "r_ens", "rho_ens", "mae_ens", "retest_r"]].round(3))
cv = pd.read_csv(os.path.join(tab, "convergent_validity_ideology_vs_slant.csv"))
cv["voice"] = cv.voice.map(lambda v: LABEL.get(v, v))
dump("convergent", cv.round(3))

ex = pd.read_json(os.path.join(an, "exemplars.json"), convert_dates=False)
ex = ex[ex.voice.isin(LABEL)].copy()
ex["voice"] = ex.voice.map(LABEL)
ex["id"] = range(len(ex))
dump("exemplars", ex[["id", "voice", "dim", "side", "score", "date", "text", "url"]])

full = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"), columns=["account", "source", "created_at", "is_repost", "analysis_sample"])
cov = full.groupby(["account", "source"]).agg(posts=("created_at", "size"), scored=("analysis_sample", "sum"),
                                              first=("created_at", "min"), last=("created_at", "max")).reset_index()
cov["first"] = cov["first"].dt.strftime("%Y-%m-%d")
cov["last"] = cov["last"].dt.strftime("%Y-%m-%d")
dump("coverage", cov.sort_values("posts", ascending=False))

dump("events", [{"date": "2017-01-20", "label": "Trump inaugurated"}, {"date": "2021-01-08", "label": "Twitter suspends @realDonaldTrump"},
                {"date": "2021-01-20", "label": "Biden inaugurated"}, {"date": "2022-02-21", "label": "Truth Social launches"},
                {"date": "2025-01-20", "label": "Trump inaugurated again"}])
