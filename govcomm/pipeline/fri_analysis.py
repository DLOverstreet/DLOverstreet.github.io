"""Fascist Rhetoric Index: descriptives, Trump II comparisons, composition, exemplars, validity.

Usage: python3 -I fri_analysis.py <data_dir> <labels_dir> <out_dir>
Reads scored_posts.parquet (with the fri_* columns from fri_student.py via assemble.py).
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

data_dir, labels_dir, out = sys.argv[1:4]
tab = os.path.join(out, "tables")
dash = os.path.join(out, "dashboard")
os.makedirs(tab, exist_ok=True)
os.makedirs(dash, exist_ok=True)
MARKERS = ["RE", "EN", "DH", "LC", "AD", "VI", "VG"]
MNAME = {"RE": "Decline and rebirth", "EN": "Existential enemy / plot", "DH": "Dehumanization / purity", "LC": "Leader cult",
         "AD": "Anti-democratic delegitimization", "VI": "Violence as virtue", "VG": "Victimhood and retribution"}
YS = ["fri", "fri_syn"] + ["fri_" + m for m in MARKERS]
T2 = pd.Timestamp("2025-01-20 17:00", tz="UTC")
ADM = ["Obama", "Trump I", "Biden", "Trump II"]

df = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"))
df = df[df.analysis_sample].copy()
df["fri_syn"] = 100 * df["fri_p_syndrome"]
df["adm"] = df.administration.replace({"Bush (43)": "Obama"})  # 41 Bush-era agency posts pooled with the earliest period
df["t2"] = (df.created_at >= T2).astype(int)
df["ym"] = df.created_at.dt.tz_convert(None).dt.to_period("M").astype(str)

# Groups. Private-citizen posts by people who later became officials are not government speech.
pre_private = df.voice.isin(["@StephenM", "@RealTomHoman"]) & (df.t2 == 0)
grp = np.select([df.voice.str.startswith("Trump"),
                 df.account_type.eq("White House (institutional)"),
                 df.account_type.isin(["Agency headquarters", "Agency field office"]),
                 df.account_type.eq("Official's account") & ~df.voice.eq("Staff (before office)") & ~pre_private],
                ["Trump, personal accounts", "White House, institutional", "Agencies (HQ and field)", "Officials and staff"],
                default="")
df["group"] = grp
df = df[df.group != ""].copy()
GROUPS = ["Trump, personal accounts", "White House, institutional", "Agencies (HQ and field)", "Officials and staff"]
TRUMP_V = {"Trump · Twitter (private citizen/candidate)": "Twitter, before office", "Trump · Twitter (President)": "Twitter, President (2017-21)",
           "Trump · Truth Social (out of office)": "Truth Social, out of office (2021-25)",
           "Trump · Truth Social (President)": "Truth Social, President (2025-)", "Trump · X (President, 2025–)": "X, President (2025-)"}
# For Trump's own accounts the period that matters is the account and office, not who held the White House.
df["period"] = np.where(df.group == "Trump, personal accounts", df.voice.map(TRUMP_V), df.adm)
gov = df[df.group != "Trump, personal accounts"]


def cell(g):
    r = {"n": len(g)}
    for y in YS:
        r[y] = g[y].mean()
    se = g["fri"].std() / np.sqrt(len(g))
    r["fri_lo"], r["fri_hi"] = r["fri"] - 1.96 * se, r["fri"] + 1.96 * se
    se = g["fri_syn"].std() / np.sqrt(len(g))
    r["syn_lo"], r["syn_hi"] = r["fri_syn"] - 1.96 * se, r["fri_syn"] + 1.96 * se
    return r


# 1. Group x period.
rows = []
for (gname, per), g in df.groupby(["group", "period"]):
    if len(g) >= 50:
        rows.append({"group": gname, "period": per, **cell(g)})
gp = pd.DataFrame(rows)
order = {p: i for i, p in enumerate(ADM + list(TRUMP_V.values()))}
gp["order"] = gp.group.map({g: i for i, g in enumerate(GROUPS)}) * 100 + gp.period.map(order)
gp = gp.sort_values("order").drop(columns="order")
gp["key"] = gp.group + " | " + gp.period
gp.to_csv(os.path.join(tab, "fri_group_period.csv"), index=False)

# 2. Every account x period with at least 50 posts.
rows = []
for (v, per), g in df.groupby(["voice", "period"]):
    if len(g) >= 50:
        rows.append({"voice": v, "group": g.group.iloc[0], "period": per, "department": g.department.iloc[0], **cell(g)})
vp = pd.DataFrame(rows)
vp["key"] = vp.voice + " | " + vp.period
vp.to_csv(os.path.join(tab, "fri_account_period.csv"), index=False)

# 3. Within-account change at Jan 20, 2025, for government accounts with 100+ posts on each side.
cnt = gov.groupby(["voice", "t2"]).size().unstack(fill_value=0)
both = cnt[(cnt.get(0, 0) >= 100) & (cnt.get(1, 0) >= 100)].index.tolist()
rows = []
for v in both:
    g = gov[gov.voice == v]
    for y in ["fri", "fri_syn"]:
        a = smf.ols(f"{y} ~ t2", data=g).fit(cov_type="cluster", cov_kwds={"groups": g["ym"]})
        b = smf.ols(f"{y} ~ t2 + C(topic)", data=g).fit(cov_type="cluster", cov_kwds={"groups": g["ym"]})
        rows.append({"voice": v, "group": g.group.iloc[0], "measure": y, "n_before": int((g.t2 == 0).sum()), "n_trump2": int(g.t2.sum()),
                     "mean_before": g.loc[g.t2 == 0, y].mean(), "mean_trump2": g.loc[g.t2 == 1, y].mean(),
                     "diff": a.params["t2"], "se": a.bse["t2"], "p": a.pvalues["t2"],
                     "diff_topic_fe": b.params["t2"], "se_topic_fe": b.bse["t2"], "p_topic_fe": b.pvalues["t2"]})
acc = pd.DataFrame(rows)
acc["key"] = acc.voice + " | " + acc.measure
acc.to_csv(os.path.join(tab, "fri_trump2_accounts.csv"), index=False)

# 4. Pooled panel: institutional accounts (White House and agencies) present on both sides; account FE, with and without topic FE.
inst = gov[gov.group.isin(["White House, institutional", "Agencies (HQ and field)"]) & gov.voice.isin(both)].copy()
inst["cl"] = inst.voice + "_" + inst.ym
rows = []
for y in YS:
    for spec, rhs in (("account FE", "C(voice)"), ("account + topic FE", "C(voice) + C(topic)")):
        m = smf.ols(f"{y} ~ C(adm, Treatment('Biden')) + {rhs}", data=inst).fit(cov_type="cluster", cov_kwds={"groups": inst["cl"]})
        for a in ["Obama", "Trump I", "Trump II"]:
            k = f"C(adm, Treatment('Biden'))[T.{a}]"
            if k in m.params:
                rows.append({"measure": y, "spec": spec, "contrast": f"{a} vs Biden", "coef": m.params[k], "se": m.bse[k], "p": m.pvalues[k]})
        k1, k2 = "C(adm, Treatment('Biden'))[T.Trump II]", "C(adm, Treatment('Biden'))[T.Trump I]"
        w = m.t_test(f"{k1} - {k2} = 0")
        rows.append({"measure": y, "spec": spec, "contrast": "Trump II vs Trump I", "coef": float(w.effect[0]), "se": float(w.sd[0][0]), "p": float(w.pvalue)})
        m2 = smf.ols(f"{y} ~ t2 + {rhs}", data=inst).fit(cov_type="cluster", cov_kwds={"groups": inst["cl"]})
        rows.append({"measure": y, "spec": spec, "contrast": "Trump II vs all earlier", "coef": m2.params["t2"], "se": m2.bse["t2"], "p": m2.pvalues["t2"]})
pan = pd.DataFrame(rows)
base = inst[inst.adm == "Biden"][YS].mean()
pan["biden_mean"] = pan.measure.map(base)
pan["key"] = pan.measure + " | " + pan.spec + " | " + pan.contrast
pan.to_csv(os.path.join(tab, "fri_panel.csv"), index=False)

# 5. Monthly group series (20+ posts), with a centered 3-month post-weighted average.
rows = []
for gname, g in df.groupby("group"):
    s = g.groupby("ym").agg(n=("fri", "size"), fri_sum=("fri", "sum"), syn_sum=("fri_syn", "sum"))
    full = pd.period_range(s.index.min(), s.index.max(), freq="M").astype(str)
    s = s.reindex(full, fill_value=0)
    r = s.rolling(3, center=True, min_periods=1).sum()
    s["fri"], s["fri_syn"] = s.fri_sum / s.n.replace(0, np.nan), s.syn_sum / s.n.replace(0, np.nan)
    s["fri_avg"], s["fri_syn_avg"] = r.fri_sum / r.n, r.syn_sum / r.n
    s = s[s.n >= 20]
    for ym, x in s.iterrows():
        rows.append({"group": gname, "month": ym + "-01", "n": int(x.n), "fri": x.fri, "fri_syn": x.fri_syn, "fri_avg": x.fri_avg, "fri_syn_avg": x.fri_syn_avg})
mon = pd.DataFrame(rows)
mon.to_csv(os.path.join(tab, "fri_monthly_groups.csv"), index=False)

# 6. Marker composition (long form) for each group x period.
comp = gp.melt(id_vars=["group", "period", "n"], value_vars=["fri_" + m for m in MARKERS], var_name="marker", value_name="mean_score")
comp["marker"] = comp.marker.str.replace("fri_", "")
comp["marker_name"] = comp.marker.map(MNAME)
comp["fri_points"] = 100 * comp.mean_score / 14  # contribution to the 0-100 index
comp["key"] = comp.group + " | " + comp.period + " | " + comp.marker
comp.to_csv(os.path.join(tab, "fri_markers.csv"), index=False)

# 7. Exemplars: highest-scoring posts in each group x period, and the highest in Democratic administrations as a check.
ex = []
for (gname, per), g in df.groupby(["group", "period"]):
    if len(g) < 50:
        continue
    top = g.sort_values("fri", ascending=False).drop_duplicates("text").head(6)
    for _, r in top.iterrows():
        mk = sorted(MARKERS, key=lambda m: -r["fri_" + m])
        ex.append({"group": gname, "period": per, "date": r.created_at.strftime("%Y-%m-%d"), "voice": r.voice, "fri": r.fri,
                   "p_syndrome": r.fri_p_syndrome, "top_markers": ", ".join(MNAME[m] for m in mk[:3] if r["fri_" + m] >= 0.3),
                   "text": (r.title + " — " if isinstance(r.title, str) and r.platform == "WhiteHouse.gov" else "") + (r.text if len(r.text) <= 420 else r.text[:420] + "…"),
                   "url": r.url, "post_id": r.post_id})
exm = pd.DataFrame(ex)
exm["key"] = exm.post_id
exm.to_csv(os.path.join(tab, "fri_exemplars.csv"), index=False)

# 8. Validity: post-level correlations with the other text scores, and the teacher-sample check by stratum.
dims = ["ideology", "partisanship", "threat_hope", "personalization", "professionalism", "party_slant"]
val = []
for name, g in [("All posts", df), ("Government accounts", gov), ("Trump, personal accounts", df[df.group == "Trump, personal accounts"])]:
    for d in dims:
        val.append({"sample": name, "score": d, "r_fri": g["fri"].corr(g[d]), "r_syndrome": g["fri_syn"].corr(g[d]), "n": len(g)})
val = pd.DataFrame(val)
val["key"] = val["sample"] + " | " + val.score
val.to_csv(os.path.join(tab, "fri_convergent.csv"), index=False)

# Share of the most extreme posts by group and period: posts above the 99th percentile of FRI in the full sample.
cut = df.fri.quantile(0.99)
tail = df.assign(top1=df.fri >= cut).groupby(["group", "period"]).agg(n=("fri", "size"), top1_share=("top1", "mean")).reset_index()
tail = tail[tail.n >= 50]
tail["top1_share"] *= 100
tail.to_csv(os.path.join(tab, "fri_top1_share.csv"), index=False)
gp = gp.merge(tail[["group", "period", "top1_share"]], on=["group", "period"], how="left")


def dump(name, frame):
    rows = json.loads(frame.to_json(orient="records", double_precision=4))
    json.dump(rows, open(os.path.join(dash, name + ".json"), "w"), ensure_ascii=False)
    print(f"{name}: {len(rows)} rows, {os.path.getsize(os.path.join(dash, name + '.json')) / 1024:.0f} KB")


dump("fri_groups", gp)
dump("fri_accounts", vp[["key", "voice", "group", "period", "department", "n", "fri", "fri_lo", "fri_hi", "fri_syn", "syn_lo", "syn_hi"] + ["fri_" + m for m in MARKERS]])
dump("fri_t2", acc)
dump("fri_panel", pan)
dump("fri_monthly", mon)
dump("fri_markers", comp)
dump("fri_exemplars", exm)
dump("fri_convergent", val)
fv = pd.read_csv(os.path.join(data_dir, "derived", "fri_validation.csv"))
fv["name"] = fv.marker.map(MNAME).fillna(fv.marker)
dump("fri_validation", fv)
fs = pd.read_csv(os.path.join(data_dir, "derived", "fri_validation_by_stratum.csv"))
dump("fri_validation_strata", fs)

pd.set_option("display.width", 250)
print(f"99th percentile FRI: {cut:.2f}")
print(gp[["group", "period", "n", "fri", "fri_syn", "top1_share"]].round(3).to_string(index=False))
print(pan[pan.measure.isin(["fri", "fri_syn"])][["measure", "spec", "contrast", "coef", "se", "p", "biden_mean"]].round(4).to_string(index=False))
print(acc[acc.measure == "fri"].sort_values("diff")[["voice", "n_before", "n_trump2", "mean_before", "mean_trump2", "diff", "se", "diff_topic_fe"]].round(3).to_string(index=False))
