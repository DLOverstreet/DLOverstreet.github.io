"""How did the second Trump administration change official messaging?

Compares every account that has scored posts both before and after Jan 20, 2025 against its own
earlier record, overall and by administration, holding topic fixed. Also fits a pooled panel over
institutional accounts (account and topic fixed effects, Biden as reference).

Usage: python3 -I trump2.py <data_dir> <out_dir>
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

data_dir, out = sys.argv[1:3]
tab = os.path.join(out, "tables")
dash = os.path.join(out, "dashboard")
os.makedirs(tab, exist_ok=True)
os.makedirs(dash, exist_ok=True)
DIMS = ["ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function"]
NORM = ["professionalism", "partisanship", "personalization", "function"]
ALL = ["norms_index"] + DIMS + ["party_slant"]
T2 = pd.Timestamp("2025-01-20 17:00", tz="UTC")
ADM_ORDER = ["Obama", "Trump I", "Biden", "Trump II"]

df = pd.read_parquet(os.path.join(data_dir, "scored_posts.parquet"))
df = df[df.analysis_sample].copy()
df["norms_index"] = df[NORM].mean(axis=1)
df["t2"] = (df.created_at >= T2).astype(int)
df["adm"] = df.administration.replace({"Bush (43)": "Bush"})
df["ym"] = df.created_at.dt.tz_convert(None).dt.to_period("M").astype(str)
# Trump's own accounts are compared on their own (office vs out of office); this module is about the government.
gov = df[~df.voice.str.startswith(("Trump", "Staff"))].copy()

MIN = 100  # scored posts needed on each side of Jan 20, 2025
cnt = gov.groupby(["voice", "t2"]).size().unstack(fill_value=0)
both = cnt[(cnt.get(0, 0) >= MIN) & (cnt.get(1, 0) >= MIN)].index.tolist()
meta = gov.groupby("voice").agg(account_type=("account_type", "first"), department=("department", "first"))

rows = []
for v in both:
    g = gov[gov.voice == v].copy()
    for d in ALL:
        fe = smf.ols(f"{d} ~ t2 + C(topic)", data=g).fit(cov_type="cluster", cov_kwds={"groups": g["ym"]})
        rows.append({"voice": v, "dimension": d, "account_type": meta.loc[v, "account_type"], "department": meta.loc[v, "department"],
                     "n_before": int((g.t2 == 0).sum()), "n_trump2": int((g.t2 == 1).sum()),
                     "first": g.created_at.min().strftime("%Y-%m-%d"),
                     "mean_before": g.loc[g.t2 == 0, d].mean(), "mean_trump2": g.loc[g.t2 == 1, d].mean(),
                     "diff_raw": g.loc[g.t2 == 1, d].mean() - g.loc[g.t2 == 0, d].mean(),
                     "diff": fe.params["t2"], "se": fe.bse["t2"], "p": fe.pvalues["t2"]})
acc = pd.DataFrame(rows)
acc["key"] = acc.voice + " | " + acc.dimension
acc.to_csv(os.path.join(tab, "trump2_account_effects.csv"), index=False)

# Means by administration for accounts that span at least two earlier administrations.
adm_rows = []
for v, g in gov.groupby("voice"):
    by = g.groupby("adm")
    n = by.size()
    keep = [a for a in ADM_ORDER if n.get(a, 0) >= 50]
    if "Trump II" not in keep or len(keep) < 3:
        continue
    for a in keep:
        ga = g[g.adm == a]
        r = {"voice": v, "administration": a, "n": len(ga)}
        for d in ALL:
            se = ga[d].std() / np.sqrt(len(ga))
            r[d], r[d + "_lo"], r[d + "_hi"] = ga[d].mean(), ga[d].mean() - 1.96 * se, ga[d].mean() + 1.96 * se
        adm_rows.append(r)
adm = pd.DataFrame(adm_rows)
adm["key"] = adm.voice + " | " + adm.administration
adm.to_csv(os.path.join(tab, "trump2_by_administration.csv"), index=False)

# Pooled panel over institutional accounts: account and topic fixed effects, Biden as reference.
inst = gov[gov.account_type.isin(["Agency headquarters", "Agency field office", "White House (institutional)"])
           & gov.voice.isin(both) & gov.adm.isin(ADM_ORDER)].copy()
inst["cl"] = inst.voice + "_" + inst.ym
panel = []
for d in ALL:
    m = smf.ols(f"{d} ~ C(adm, Treatment('Biden')) + C(voice) + C(topic)", data=inst).fit(cov_type="cluster", cov_kwds={"groups": inst["cl"]})
    for a in ["Obama", "Trump I", "Trump II"]:
        k = f"C(adm, Treatment('Biden'))[T.{a}]"
        if k in m.params:
            panel.append({"dimension": d, "administration": a, "coef_vs_biden": m.params[k], "se": m.bse[k], "p": m.pvalues[k]})
    k1, k2 = "C(adm, Treatment('Biden'))[T.Trump II]", "C(adm, Treatment('Biden'))[T.Trump I]"
    if k1 in m.params and k2 in m.params:
        w = m.t_test(f"{k1} - {k2} = 0")
        panel.append({"dimension": d, "administration": "Trump II minus Trump I", "coef_vs_biden": float(w.effect[0]),
                      "se": float(w.sd[0][0]), "p": float(w.pvalue)})
    m2 = smf.ols(f"{d} ~ t2 + C(voice) + C(topic)", data=inst).fit(cov_type="cluster", cov_kwds={"groups": inst["cl"]})
    panel.append({"dimension": d, "administration": "Trump II vs all earlier", "coef_vs_biden": m2.params["t2"], "se": m2.bse["t2"], "p": m2.pvalues["t2"]})
pan = pd.DataFrame(panel)
pan["key"] = pan.dimension + " | " + pan.administration
pan.to_csv(os.path.join(tab, "trump2_panel.csv"), index=False)

# Agenda: topic and villain shares before vs during Trump II. Shares are computed within each
# institutional account and then averaged with equal weight, so the comparison is not driven by
# which accounts the archives happen to cover more heavily in each period.
ag = []
for col in ["topic", "villain"]:
    per = inst.groupby(["voice", "t2"])[col].value_counts(normalize=True).rename("share").reset_index()
    cats = inst[col].unique()
    full = pd.MultiIndex.from_product([inst.voice.unique(), [0, 1], cats], names=["voice", "t2", col])
    per = per.set_index(["voice", "t2", col]).reindex(full, fill_value=0).reset_index()
    sh = per.groupby(["t2", col]).share.mean().reset_index()
    sh["kind"] = col
    sh = sh.rename(columns={col: "category"})
    ag.append(sh)
agenda = pd.concat(ag)
agenda["period"] = np.where(agenda.t2 == 1, "Trump II", "Before Jan 2025")
agenda["key"] = agenda.kind + " | " + agenda.category + " | " + agenda.period
agenda[["key", "kind", "category", "period", "share"]].to_csv(os.path.join(tab, "trump2_agenda.csv"), index=False)

# Coverage: posts per account per year, to show where the Trump II data are thick or thin.
cov = gov.groupby(["voice", gov.created_at.dt.year.rename("year")]).size().rename("posts").reset_index()
cov.to_csv(os.path.join(tab, "trump2_coverage_by_year.csv"), index=False)


def dump(name, frame):
    rows = json.loads(frame.to_json(orient="records", double_precision=4))
    json.dump(rows, open(os.path.join(dash, name + ".json"), "w"), ensure_ascii=False)
    print(f"{name}: {len(rows)} rows")


dump("t2_accounts", acc)
dump("t2_admin", adm)
dump("t2_panel", pan)
dump("t2_agenda", agenda[["key", "kind", "category", "period", "share"]])
cv = cov[cov.year >= 2016].pivot(index="voice", columns="year", values="posts").fillna(0).astype(int)
cv.columns = [str(c) for c in cv.columns]
cv = cv.reset_index()
cv["total"] = cv.drop(columns="voice").sum(axis=1)
cv["trump2"] = gov[gov.t2 == 1].groupby("voice").size().reindex(cv.voice).fillna(0).astype(int).values
dump("t2_coverage", cv.sort_values("trump2", ascending=False))

pd.set_option("display.width", 250)
print("accounts with >=%d posts on both sides:" % MIN, len(both))
print(acc[acc.dimension == "norms_index"].sort_values("diff")[["voice", "n_before", "n_trump2", "mean_before", "mean_trump2", "diff", "se"]].round(3).to_string(index=False))
print(pan.round(3).to_string(index=False))
