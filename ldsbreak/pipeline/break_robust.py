"""Robustness checks for the breakpoint DiD estimates.

  1. Race treated group without passages that are also Lamanite-dictionary members (1970s race talk overlaps
     Kimball-era Lamanite lineage discourse, which faded after 1978 for reasons unrelated to OD 2).
  2. Race treated group restricted to passages with at least one strong race term.
  3. Race 1978 step measured against 1970-73 instead of the full pre-period (the 1974-Jun 1978 bins dip).
  4. Leave-one-control-out: re-estimate each main DiD dropping one control topic at a time.
  5. Teacher codes: race D3 before/after June 1978 without Native American / Lamanite (N) passages.

Usage: python3 -I break_robust.py <topics.parquet> <scores.parquet> <labels_dir> <out_dir>
"""
import sys
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm

warnings.filterwarnings("ignore")
tp, scp, labels_dir, out = sys.argv[1:5]
DIMS = ["D1", "D2", "D3", "D4"]
CONTROLS = ["TITHING", "WOW", "SABBATH", "PRAYER", "WELFARE", "CHASTITY"]
BREAK = {"RACE": pd.Timestamp("1978-06-09"), "MINISTER": pd.Timestamp("2018-03-01")}
t = pd.read_parquet(tp).merge(pd.read_parquet(scp), on="chunk_id")
t["date"] = pd.to_datetime(t.date)
t["conf"] = t.date.dt.strftime("%Y-%m")
t["member"] = t.topics.fillna("").str.split(",")
modern = t[t.source.eq("General Conference") | (t.source.eq("Conference Report") & t.year.eq(1970))]


def panel(case, lo=None, hi=None, controls=CONTROLS, keep=None):
    m = modern
    if lo:
        m = m[m.date >= pd.Timestamp(lo)]
    if hi:
        m = m[m.date <= pd.Timestamp(hi)]
    isT = m.member.apply(lambda x: case in x)
    tr = m[isT].assign(topic=case, treat=1, w=m.loc[isT, f"p_rel_{case}"])
    if keep is not None:
        tr = tr[keep(tr)]
    co = m[~isT & m.primary.isin(controls)].assign(topic=lambda x: x.primary, treat=0, w=lambda x: x.p_rel)
    return pd.concat([tr, co], ignore_index=True)


def did(df, y, post):
    df = df.assign(tp=df.treat * post)
    Z = [df[["tp"]].astype(float)] + [pd.get_dummies(df[f], prefix=f, drop_first=True, dtype=float) for f in ("topic", "conf")]
    Z = sm.add_constant(pd.concat(Z, axis=1))
    f = sm.WLS(df[y].astype(float), Z, weights=df.w.clip(lower=1e-3)).fit(cov_type="cluster", cov_kwds={"groups": pd.factorize(df.talk_id)[0]})
    return dict(beta=f.params["tp"], se=f.bse["tp"], p=f.pvalues["tp"], n=len(df), n_treated=int(df.treat.sum()))


rows = []
WIN = {"RACE": ("1970-01-01", "1989-12-31"), "MINISTER": ("2006-01-01", None)}
for name, kw in [("no Lamanite overlap", dict(keep=lambda d: ~d.member.apply(lambda x: "LAMANITE" in x))),
                 ("strong race term required", dict(keep=lambda d: d.race_strong >= 1))]:
    for lo, hi, win in [(*WIN["RACE"], "1971-89 window"), (None, None, "full 1970-2026")]:
        p = panel("RACE", lo, hi, **kw)
        for y in DIMS:
            rows.append(dict(case="RACE", check=name, window=win, outcome=y, **did(p, y, (p.date >= BREAK["RACE"]).astype(int))))
# 1978 step against 1970-73 only (drop the 1974-Jun 1978 dip from the pre-period)
for name, kw in [("pre = 1970-73 only", {}), ("pre = 1970-73 only, no Lamanite overlap", dict(keep=lambda d: ~d.member.apply(lambda x: "LAMANITE" in x)))]:
    p = panel("RACE", "1970-01-01", "1989-12-31", **kw)
    p = p[(p.date < pd.Timestamp("1974-01-01")) | (p.date >= BREAK["RACE"])]
    for y in DIMS:
        rows.append(dict(case="RACE", check=name, window="1970-73 vs Oct 1978-89", outcome=y, **did(p, y, (p.date >= BREAK["RACE"]).astype(int))))
# leave one control out
for case in ["RACE", "MINISTER"]:
    for drop in CONTROLS:
        p = panel(case, *WIN[case], controls=[c for c in CONTROLS if c != drop])
        for y in DIMS:
            rows.append(dict(case=case, check=f"drop control {drop}", window="main window", outcome=y, **did(p, y, (p.date >= BREAK[case]).astype(int))))
rob = pd.DataFrame(rows)
rob.to_csv(f"{out}/robustness.csv", index=False)
pd.set_option("display.width", 200)
print(rob[~rob.check.str.startswith("drop")].pivot_table(index=["case", "check", "window"], columns="outcome", values=["beta", "p"]).round(3).to_string())
loo = rob[rob.check.str.startswith("drop")].groupby(["case", "outcome"]).beta.agg(["min", "max"]).round(3)
print("\nleave-one-control-out range of DiD estimates:\n", loo.to_string())

lab = pd.read_csv(f"{labels_dir}/break_labels.csv").merge(pd.read_csv(f"{labels_dir}/break_sample_key.csv"), on="lid")
lab["fl"] = lab["flags"].fillna("")
r = lab[lab.case.eq("RACE") & lab.rel.eq(1) & lab.source.eq("General Conference")].assign(date=lambda x: pd.to_datetime(x.date))
for nm, s in [("all relevant", r), ("without N (Native American/Lamanite) passages", r[~r.fl.str.contains("N")])]:
    pre, post = s[s.date < BREAK["RACE"]], s[(s.date >= BREAK["RACE"]) & (s.date < pd.Timestamp("1990-01-01"))]
    print(f"teacher race D3 {nm}: 1971-Jun78 {pre.D3.mean():.2f} (n={len(pre)}) -> Oct78-89 {post.D3.mean():.2f} (n={len(post)})")
