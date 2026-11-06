"""Causal and descriptive analyses for the breakpoint study.

Cases
  RACE      June 1978 (Official Declaration 2). Later candidate breaks: Dec 2013 (Gospel Topics essay "Race and the
            Priesthood"), June 2020 (First Presidency/NAACP statements; Oct 2020 conference on racism).
  MINISTER  April 2018 (ministering replaces home and visiting teaching).
Controls    TITHING, WOW, SABBATH, PRAYER, WELFARE, CHASTITY (passages whose primary topic is a control topic and
            which are not members of the treated topic). MISSION, TEMPLE, LAMANITE are spillover topics, kept out.

Outcomes are the student's calibrated D1-D4 scores, weighted by the student's probability that the passage
substantively engages its topic. Every regression has topic and conference fixed effects; standard errors are
clustered by talk. Teacher codes are used directly where they are a census (GC race passages) and as a
design-weighted robustness check elsewhere.

Usage: python3 -I break_analysis.py <topics.parquet> <scores.parquet> <talks.parquet> <talk_ranks.csv> <labels_dir> <out_dir>
"""
import os
import re
import sys
import warnings

import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy.optimize import minimize

warnings.filterwarnings("ignore")
tp, scp, talks_path, ranks_path, labels_dir, out = sys.argv[1:7]
os.makedirs(out, exist_ok=True)
DIMS = ["D1", "D2", "D3", "D4"]
CONTROLS = ["TITHING", "WOW", "SABBATH", "PRAYER", "WELFARE", "CHASTITY"]
RANKS = ["FP", "Q12", "GA", "AUX"]
BREAK = {"RACE": pd.Timestamp("1978-06-09"), "MINISTER": pd.Timestamp("2018-03-01")}
rng = np.random.default_rng(2018)

t = pd.read_parquet(tp).merge(pd.read_parquet(scp), on="chunk_id")
t["date"] = pd.to_datetime(t.date)
t["conf"] = t.date.dt.strftime("%Y-%m")
t["member"] = t.topics.fillna("").str.split(",")
modern = t[t.source.eq("General Conference") | (t.source.eq("Conference Report") & t.year.eq(1970))].copy()


def panel(case, lo=None, hi=None, controls=CONTROLS):
    """Treated rows: members of the treated topic. Control rows: primary topic in controls, not treated members."""
    m = modern
    if lo is not None:
        m = m[m.date >= pd.Timestamp(lo)]
    if hi is not None:
        m = m[m.date <= pd.Timestamp(hi)]
    isT = m.member.apply(lambda x: case in x)
    tr = m[isT].assign(topic=case, treat=1, w=m.loc[isT, f"p_rel_{case}"] if f"p_rel_{case}" in m else m.loc[isT, "p_rel"])
    co = m[~isT & m.primary.isin(controls)].assign(topic=lambda x: x.primary, treat=0, w=lambda x: x.p_rel)
    return pd.concat([tr, co], ignore_index=True)


def ols(df, y, X, w="w", fe=("topic", "conf"), cluster="talk_id"):
    """WLS with fixed effects as dummies, cluster-robust SEs. X: list of regressor columns. Returns fitted model."""
    D = [df[X].astype(float)]
    for f in fe:
        D.append(pd.get_dummies(df[f], prefix=f, drop_first=True, dtype=float))
    Z = sm.add_constant(pd.concat(D, axis=1))
    Z = Z.loc[:, Z.std() > 0].assign(const=1.0) if Z.shape[1] > 1 else Z
    g = pd.factorize(df[cluster])[0]
    return sm.WLS(df[y].astype(float), Z, weights=df[w].clip(lower=1e-3)).fit(cov_type="cluster", cov_kwds={"groups": g})


def did(df, y, post_col="post", fe=("topic", "conf"), w="w"):
    df = df.assign(tp=df.treat * df[post_col])
    if df.tp.sum() == 0 or (df.treat * (1 - df[post_col])).sum() == 0:
        return dict(beta=np.nan, se=np.nan, p=np.nan, n=len(df), n_treated=int(df.treat.sum()))
    f = ols(df, y, ["tp"], w=w, fe=fe)
    return dict(beta=f.params["tp"], se=f.bse["tp"], p=f.pvalues["tp"], n=len(df), n_treated=int(df.treat.sum()))


res = []
# ------------------------------------------------------------------ 1. Main difference-in-differences
SPECS = {
    "RACE": [("1971-89 window", "1970-01-01", "1989-12-31"), ("full 1970-2026", None, None)],
    "MINISTER": [("2006-26 window", "2006-01-01", None), ("full 1970-2026", None, None)],
}
for case, specs in SPECS.items():
    for name, lo, hi in specs:
        p = panel(case, lo, hi)
        p["post"] = (p.date >= BREAK[case]).astype(int)
        for y in DIMS:
            res.append(dict(case=case, window=name, spec="topic+conference FE, p_rel weights", outcome=y, **did(p, y)))
            res.append(dict(case=case, window=name, spec="+ speaker FE (within-speaker)", outcome=y,
                            **did(p, y, fe=("topic", "conf", "speaker_n"))))
            res.append(dict(case=case, window=name, spec="unweighted", outcome=y, **did(p.assign(w1=1.0), y, w="w1")))
            hi_rel = p[p.w >= 0.5]
            res.append(dict(case=case, window=name, spec="p_rel >= 0.5 only", outcome=y, **did(hi_rel, y)))
did_tab = pd.DataFrame(res)
did_tab.to_csv(f"{out}/did_main.csv", index=False)
print("\n== DiD (treated x post) ==")
print(did_tab.pivot_table(index=["case", "window", "spec"], columns="outcome", values="beta").round(3).to_string())

# Multi-break model for race over the full span: cumulative steps at 1978, 2014 (essay), mid-2020.
p = panel("RACE")
steps = {"post1978": "1978-06-09", "post2014": "2014-01-01", "post2020": "2020-07-01"}
mb = []
for k, v in steps.items():
    p[k] = (p.date >= pd.Timestamp(v)).astype(int)
    p["T_" + k] = p.treat * p[k]
for y in DIMS:
    f = ols(p, y, ["T_" + k for k in steps])
    for k in steps:
        mb.append(dict(outcome=y, step=k, beta=f.params["T_" + k], se=f.bse["T_" + k], p=f.pvalues["T_" + k]))
mb = pd.DataFrame(mb)
mb.to_csv(f"{out}/race_multibreak.csv", index=False)
print("\n== Race multi-break DiD (incremental step at each date) ==")
print(mb.pivot_table(index="step", columns="outcome", values=["beta", "p"]).round(3).to_string())

# ------------------------------------------------------------------ 2. Event studies
ev = []
# Reference bins are pooled (thin single-year references are noisy): ministering 2015-17, race 1974-Jun 1978.
for case, lo, hi, width, kmin, kmax, ref in [("RACE", "1970-01-01", "1999-12-31", 2, -4, 10, {-2, -1}), ("MINISTER", "2004-01-01", None, 1, -14, 8, {-3, -2, -1}),
                                             ("RACE", "1970-01-01", None, 4, -2, 11, {-1})]:
    p = panel(case, lo, hi)
    et = np.floor(((p.date - BREAK[case]).dt.days / 365.25) / width).astype(int).clip(kmin, kmax)
    ks = sorted(set(et) - ref)
    for k in ks:
        p[f"e{k}".replace("-", "m")] = ((et == k) & (p.treat == 1)).astype(int)
    cols = [f"e{k}".replace("-", "m") for k in ks]
    for y in DIMS:
        f = ols(p, y, cols)
        for k, c in zip(ks, cols):
            ev.append(dict(case=case, bin_years=width, k=k, start=int(BREAK[case].year + k * width), outcome=y,
                           beta=f.params[c], se=f.bse[c], n_t=int(p[c].sum())))
        for k in ref:
            ev.append(dict(case=case, bin_years=width, k=k, start=int(BREAK[case].year + k * width), outcome=y, beta=0.0, se=0.0,
                           n_t=int(((et == k) & (p.treat == 1)).sum())))
ev = pd.DataFrame(ev).sort_values(["case", "bin_years", "outcome", "k"])
ev.to_csv(f"{out}/event_study.csv", index=False)
# Pre-trend joint test: are the pre-period coefficients jointly zero? (ministering, annual)
pre = ev[(ev.case == "MINISTER") & (ev.k < -3)]
print("\n== Ministering pre-period (2004-14) event-study coefficients vs 2015-17 (mean, max |t|) ==")
print(pre.groupby("outcome").apply(lambda g: pd.Series({"mean_beta": g.beta.mean(), "max_abs_t": (g.beta / g.se).abs().max()})).round(3))

# ------------------------------------------------------------------ 3. Break-date scan (sup-Wald style)
scan = []
for case, lo, years in [("RACE", None, range(1974, 2025)), ("MINISTER", "1990-01-01", range(1996, 2025))]:
    p = panel(case, lo)
    for tau in years:
        p["post"] = (p.date >= pd.Timestamp(f"{tau}-01-01")).astype(int)
        for y in DIMS:
            r = did(p, y)
            scan.append(dict(case=case, tau=tau, outcome=y, beta=r["beta"], se=r["se"], t=r["beta"] / r["se"]))
scan = pd.DataFrame(scan)
scan.to_csv(f"{out}/break_scan.csv", index=False)
print("\n== Break-date scan: year with the largest |t| for the treated-minus-control step ==")
best = scan.loc[scan.groupby(["case", "outcome"]).t.apply(lambda s: s.abs().idxmax())]
print(best.round(3).to_string(index=False))
for case, yr in [("RACE", 1978), ("RACE", 2014), ("RACE", 2020), ("MINISTER", 2018)]:
    print(case, yr, scan[(scan.case == case) & (scan.tau == yr)][["outcome", "beta", "t"]].round(3).to_dict("records"))

# ------------------------------------------------------------------ 4. Annual series and synthetic control
def annual(case_list, lo=1970):
    rows = []
    for case in case_list:
        isT = modern.member.apply(lambda x: case in x)
        m = modern[isT]
        w = m[f"p_rel_{case}"] if f"p_rel_{case}" in m else m.p_rel
        m = m.assign(w=w)
        if case in CONTROLS:  # control topics are defined by primary topic
            m = modern[modern.primary.eq(case)].assign(w=lambda x: x.p_rel)
        for yr, g in m[m.year >= lo].groupby("year"):
            r = dict(topic=case, year=int(yr), n=len(g), wsum=g.w.sum())
            for y in DIMS:
                r[y] = np.average(g[y], weights=g.w)
            rows.append(r)
    return pd.DataFrame(rows)


ser = annual(["RACE", "MINISTER", "MISSION", "TEMPLE", "LAMANITE"] + CONTROLS)
tot = modern.groupby("year").size()
ser["per1000"] = 1000 * ser.wsum / ser.year.map(tot)
ser.to_csv(f"{out}/series_annual.csv", index=False)


def synth(Y, treated, donors, pre, post):
    """De-meaned synthetic control: convex donor weights that best match the treated unit's pre-period deviations."""
    yt = Y[treated]
    D = Y[donors]
    a = yt[pre].mean() - D.loc[pre].mean()
    A = D.loc[pre] - D.loc[pre].mean()
    b = yt[pre] - yt[pre].mean()
    k = len(donors)
    obj = lambda w: ((b.values - A.values @ w) ** 2).mean()
    w = minimize(obj, np.repeat(1 / k, k), bounds=[(0, 1)] * k, constraints={"type": "eq", "fun": lambda w: w.sum() - 1}, method="SLSQP").x
    syn = D.values @ w + (yt[pre].mean() - (D.loc[pre].values @ w).mean())
    gap = yt.values - syn
    idx = Y.index
    rm_pre = np.sqrt((gap[idx.isin(pre)] ** 2).mean())
    rm_post = np.sqrt((gap[idx.isin(post)] ** 2).mean())
    return pd.Series(syn, index=idx), pd.Series(gap, index=idx), dict(zip(donors, w.round(3))), rm_pre, rm_post, gap[idx.isin(post)].mean()


syn_rows, syn_sum = [], []
for case, yrs, pre_end, post_end in [("MINISTER", range(1996, 2027), 2017, 2026), ("RACE", range(1971, 1990), 1977, 1989)]:
    for y in DIMS:
        Y = ser.pivot(index="year", columns="topic", values=y).reindex(list(yrs)).interpolate(limit_direction="both")
        pre = [x for x in yrs if x <= pre_end]
        post = [x for x in yrs if pre_end < x <= post_end]
        units = [case] + CONTROLS
        for u in units:
            donors = [c for c in CONTROLS if c != u]
            syn, gap, wts, rp, rq, mg = synth(Y, u, donors, pre, post)
            syn_sum.append(dict(case=case, outcome=y, unit=u, is_treated=u == case, rmspe_pre=rp, rmspe_post=rq,
                                ratio=rq / rp, mean_post_gap=mg, weights=str(wts) if u == case else ""))
            if u == case:
                for yr in yrs:
                    syn_rows.append(dict(case=case, outcome=y, year=yr, treated=Y.loc[yr, case], synthetic=syn[yr], gap=gap[yr]))
syn_sum = pd.DataFrame(syn_sum)
syn_sum["perm_rank"] = syn_sum.groupby(["case", "outcome"]).ratio.rank(ascending=False)
syn_sum["perm_p"] = syn_sum.perm_rank / syn_sum.groupby(["case", "outcome"]).ratio.transform("size")
syn_sum.to_csv(f"{out}/synth_summary.csv", index=False)
pd.DataFrame(syn_rows).to_csv(f"{out}/synth_series.csv", index=False)
print("\n== Synthetic control (treated unit): mean post gap, RMSPE ratio and permutation p over 7 units ==")
print(syn_sum[syn_sum.is_treated][["case", "outcome", "mean_post_gap", "rmspe_pre", "ratio", "perm_p", "weights"]].round(3).to_string(index=False))

# ------------------------------------------------------------------ 5. Placebos
plac = []
for case in ["RACE", "MINISTER"]:
    lo, hi = SPECS[case][0][1], SPECS[case][0][2]
    for fake in CONTROLS:
        others = [c for c in CONTROLS if c != fake]
        m = modern if lo is None else modern[modern.date >= pd.Timestamp(lo)]
        m = m if hi is None else m[m.date <= pd.Timestamp(hi)]
        p = m[m.primary.isin(CONTROLS)].assign(topic=lambda x: x.primary, treat=lambda x: (x.primary == fake).astype(int), w=lambda x: x.p_rel)
        p["post"] = (p.date >= BREAK[case]).astype(int)
        for y in DIMS:
            plac.append(dict(case=case, kind="placebo topic", placebo=fake, outcome=y, **did(p, y)))
    # in-time placebos: fake break dates inside the pre-period only
    fakes = range(1973, 1978) if case == "RACE" else range(2009, 2017)
    p0 = panel(case, "1970-01-01" if case == "RACE" else "2000-01-01", BREAK[case] - pd.Timedelta(days=1))
    for yr in fakes:
        p0["post"] = (p0.date >= pd.Timestamp(f"{yr}-01-01")).astype(int)
        for y in DIMS:
            plac.append(dict(case=case, kind="placebo date (pre-period only)", placebo=str(yr), outcome=y, **did(p0, y)))
plac = pd.DataFrame(plac)
plac.to_csv(f"{out}/placebos.csv", index=False)
main = did_tab[(did_tab.spec == "topic+conference FE, p_rel weights") & did_tab.window.isin(["1971-89 window", "2006-26 window"])]
print("\n== Placebo-topic permutation: share of placebo |beta| >= treated |beta| ==")
for (case, y), g in plac[plac.kind == "placebo topic"].groupby(["case", "outcome"]):
    b = main[(main.case == case) & (main.outcome == y)].beta.iloc[0]
    print(case, y, "treated beta", round(b, 3), "placebo betas", g.beta.round(3).tolist(),
          "perm p", round(((g.beta.abs() >= abs(b)).sum() + 1) / (len(g) + 1), 3))
print(plac[plac.kind.str.startswith("placebo date")].pivot_table(index=["case", "placebo"], columns="outcome", values="beta").round(3))

# ------------------------------------------------------------------ 5b. Attention: volume of relevant discourse
tot_c = modern.groupby("conf").size()
vol = []
for case in ["RACE", "MINISTER"]:
    for name, lo, hi in SPECS[case]:
        p = panel(case, lo, hi)
        v = p.groupby(["conf", "topic"]).w.sum().rename("w").reset_index()
        grid = pd.MultiIndex.from_product([sorted(p.conf.unique()), sorted(p.topic.unique())], names=["conf", "topic"]).to_frame(index=False)
        v = grid.merge(v, how="left").fillna({"w": 0.0})
        v["treat"] = v.topic.eq(case).astype(int)
        v["per1000"] = 1000 * v.w / v.conf.map(tot_c)
        v["ly"] = np.log1p(v.per1000)
        v["post"] = (pd.to_datetime(v.conf + "-05") >= BREAK[case]).astype(int)
        v["talk_id"], v["one"] = v.conf, 1.0
        r = did(v, "ly", w="one")
        mt_ = v.groupby(["treat", "post"]).per1000.mean()
        vol.append(dict(case=case, window=name, outcome="log(1+relevant passages per 1,000)", **r,
                        treated_pre=mt_.get((1, 0)), treated_post=mt_.get((1, 1)), control_pre=mt_.get((0, 0)), control_post=mt_.get((0, 1))))
vol = pd.DataFrame(vol)
vol.to_csv(f"{out}/volume_did.csv", index=False)
print("\n== Attention DiD (conference x topic panel; relevant passages per 1,000 conference passages) ==")
print(vol.round(3).to_string(index=False))

# ------------------------------------------------------------------ 6. Teacher codes: race census and design-weighted checks
lab = pd.read_csv(f"{labels_dir}/break_labels.csv").merge(pd.read_csv(f"{labels_dir}/break_sample_key.csv"), on="lid")
lab["fl"] = lab["flags"].fillna("")
lab["date"] = pd.to_datetime(lab.date)
PER = [("JoD 1851-86", "1850-01-01", "1886-12-31"), ("1971-Apr 1978", "1970-01-01", "1978-06-08"), ("Oct 1978-89", "1978-06-09", "1989-12-31"),
       ("1990-2005", "1990-01-01", "2005-12-31"), ("2006-13", "2006-01-01", "2013-12-31"), ("2014-Apr 2020", "2014-01-01", "2020-06-30"),
       ("Oct 2020-26", "2020-07-01", "2026-12-31")]


def period(d, src):
    if src == "Journal of Discourses":
        return PER[0][0]
    if src == "Conference Report" and d.year < 1900:
        return "CR 1880/1897"
    for nm, a, b in PER[1:]:
        if pd.Timestamp(a) <= d <= pd.Timestamp(b):
            return nm


lab["period"] = [period(d, s) for d, s in zip(lab.date, lab.source)]


def boot(d, keys):
    """Stratified bootstrap resample: draw with replacement within each stratum."""
    return d.iloc[np.concatenate([rng.choice(ix, len(ix)) for ix in d.groupby(keys).indices.values()])]


def wdid(d, y):
    m = lambda s: np.average(d.loc[s, y], weights=d.loc[s, "w"]) if s.any() else np.nan
    T, P = d.treat.eq(1), d.post.eq(1)
    return (m(T & P) - m(T & ~P)) - (m(~T & P) - m(~T & ~P))
race = lab[lab.case.eq("RACE")]
rows = []
for per_, g in race.groupby("period", sort=False):
    gr = g[g.rel == 1]
    r = dict(period=per_, candidates=len(g), relevant=len(gr))
    for y in DIMS:
        r[y] = gr[y].mean()
    for f in "LRVEAGSN":
        r["flag_" + f] = gr.fl.str.contains(f).mean()
    rows.append(r)
race_per = pd.DataFrame(rows).set_index("period").reindex([p[0] for p in PER]).reset_index()
gcpas = modern.groupby(pd.cut(modern.date, [pd.Timestamp(a) - pd.Timedelta(days=1) for _, a, _ in PER[1:]] + [pd.Timestamp("2027-01-01")],
                              labels=[p[0] for p in PER[1:]])).size()
race_per["relevant_per_1000_passages"] = race_per.period.map(1000 * race_per.set_index("period").relevant / gcpas)
race_per.to_csv(f"{out}/race_teacher_periods.csv", index=False)
print("\n== Race passages, teacher codes (GC census + JoD sample), relevant passages only ==")
print(race_per.round(2).to_string(index=False))

rr = race[(race.rel == 1) & race.source.eq("General Conference")]
rk = rr.groupby(["period", "rank"]).agg(n=("D3", "size"), D3=("D3", "mean"), A=("fl", lambda s: s.str.contains("A").mean()),
                                        E=("fl", lambda s: s.str.contains("E").mean()), V=("fl", lambda s: s.str.contains("V").mean())).reset_index()
rk.to_csv(f"{out}/race_teacher_rank_period.csv", index=False)
print(rk.pivot_table(index="period", columns="rank", values=["n", "D3", "A"]).reindex([p[0] for p in PER[1:]]).round(2).to_string())

# Within-speaker: speakers with relevant race passages on both sides of June 1978 (teacher census)
ws = race[(race.rel == 1) & race.source.eq("General Conference")].assign(post=lambda x: (x.date >= BREAK["RACE"]).astype(int))
ws = ws.groupby(["speaker_n", "post"]).D3.agg(["mean", "size"]).unstack()
ws = ws[ws[("size", 0)].notna() & ws[("size", 1)].notna()]
ws.to_csv(f"{out}/race_within_speaker.csv")
print("\n== Race D3 within speaker, pre vs post June 1978 (teacher codes) ==")
print(ws.round(2).to_string())

# Teacher DiD for race: relevant race passages vs teacher-coded control passages, 1970-Jun 1978 vs Oct 1978-1989
tc = lab[(lab.case.eq("CONTROL") & lab.topic.isin(CONTROLS)) | (lab.case.eq("RACE") & lab.rel.eq(1) & lab.source.eq("General Conference"))]
tc = tc[(tc.date >= pd.Timestamp("1970-01-01")) & (tc.date <= pd.Timestamp("1989-12-31"))].assign(
    treat=lambda x: x.case.eq("RACE").astype(int), post=lambda x: (x.date >= BREAK["RACE"]).astype(int),
    w=lambda x: np.where(x.case.eq("RACE"), 1.0, x.N / x.n))
rt = []
for y in DIMS:
    est = wdid(tc, y)
    bs = [wdid(boot(tc, ["treat", "post"]), y) for _ in range(500)]
    rt.append(dict(outcome=y, beta=est, ci_lo=np.nanpercentile(bs, 2.5), ci_hi=np.nanpercentile(bs, 97.5),
                   n_race_pre=int((tc.treat.eq(1) & tc.post.eq(0)).sum()), n_race_post=int((tc.treat.eq(1) & tc.post.eq(1)).sum())))
rt = pd.DataFrame(rt)
rt.to_csv(f"{out}/race_teacher_did.csv", index=False)
print("\n== Race teacher-code DiD, 1970-Jun 1978 vs Oct 1978-89 (race census vs design-weighted controls) ==")
print(rt.round(3).to_string(index=False))

# Teacher changepoints in the race census (GC passages, relevant): optimal partition into year segments, BIC penalty.
def segment(df, y, minseg=8, minyears=4, maxk=4):
    yrs = np.array(sorted(df.year.unique()))
    by = df.groupby("year")[y].agg(["sum", "count"]).reindex(yrs)
    s2 = df.groupby("year")[y].apply(lambda v: (v ** 2).sum()).reindex(yrs)
    cs, cn, cq = np.r_[0, by["sum"].cumsum()], np.r_[0, by["count"].cumsum()], np.r_[0, s2.cumsum()]
    def cost(i, j):  # SSE of years i..j-1
        n = cn[j] - cn[i]
        return cq[j] - cq[i] - (cs[j] - cs[i]) ** 2 / n if n else 0
    n, J = len(df), len(yrs)
    best = {}
    for k in range(1, maxk + 1):  # k segments
        # DP over segment ends
        C = np.full((k + 1, J + 1), np.inf); C[0, 0] = 0; B = np.zeros((k + 1, J + 1), int)
        for s in range(1, k + 1):
            for j in range(1, J + 1):
                for i in range(s - 1, j):
                    if cn[j] - cn[i] < minseg or yrs[j - 1] - yrs[i] + 1 < minyears:
                        continue
                    v = C[s - 1, i] + cost(i, j)
                    if v < C[s, j]:
                        C[s, j], B[s, j] = v, i
        if not np.isfinite(C[k, J]):
            break
        cuts, j = [], J
        for s in range(k, 0, -1):
            i = B[s, j]; cuts.append(i); j = i
        cuts = sorted(c for c in cuts if c > 0)
        sse = C[k, J]
        best[k] = dict(k=k, breaks=[int(yrs[c]) for c in cuts], sse=sse, bic=n * np.log(sse / n) + (2 * k - 1) * np.log(n))
    return pd.DataFrame(best.values())


rr = rr.assign(A=rr.fl.str.contains("A").astype(float), E=rr.fl.str.contains("E").astype(float), V=rr.fl.str.contains("V").astype(float))
cp = []
for y in ["D3", "D2", "A", "E", "V"]:
    s = segment(rr, y)
    s["outcome"] = y
    cp.append(s)
    # bootstrap the single-break location (resample talks)
    talks = rr.talk_id.unique()
    locs = []
    for _ in range(300):
        bs = rr.set_index("talk_id").loc[rng.choice(talks, len(talks))].reset_index()
        r2 = segment(bs, y, maxk=2)
        if len(r2) > 1:
            locs.append(r2.iloc[1].breaks[0])
    locs = pd.Series(locs)
    s2 = s[s.k == 2]
    print(f"race teacher {y}: best k by BIC={int(s.loc[s.bic.idxmin(), 'k'])} breaks={s.loc[s.bic.idxmin(), 'breaks']}; "
          f"single-break={s2.breaks.iloc[0] if len(s2) else None}; bootstrap single-break modes {locs.value_counts(normalize=True).head(4).round(2).to_dict()}")
    cp.append(pd.DataFrame([dict(outcome=y, k=-1, breaks=str(locs.value_counts(normalize=True).round(3).to_dict()), sse=np.nan, bic=np.nan)]))
pd.concat(cp).to_csv(f"{out}/race_changepoints.csv", index=False)

# Design-weighted teacher DiD for ministering (strata weights N/n), bootstrap within strata.
mt = lab[lab.case.isin(["MINISTER", "CONTROL"]) & (lab.case.eq("MINISTER") | lab.topic.isin(CONTROLS))].copy()
mt = mt[mt.date >= pd.Timestamp("2006-01-01")]
mt["treat"] = mt.case.eq("MINISTER").astype(int)
mt["post"] = (mt.date >= BREAK["MINISTER"]).astype(int)
mt["w"] = mt.N / mt.n


tdid = []
for y in DIMS:
    est = wdid(mt, y)
    bs = [wdid(boot(mt, "stratum"), y) for _ in range(500)]
    tdid.append(dict(outcome=y, beta=est, ci_lo=np.nanpercentile(bs, 2.5), ci_hi=np.nanpercentile(bs, 97.5), n=len(mt)))
for f in "PCMH":
    mm = mt[mt.treat.eq(1) & mt.rel.eq(1)]
    tdid.append(dict(outcome=f"flag {f} share pre/post (relevant ministering passages)",
                     beta=mm[mm.post == 1].fl.str.contains(f).mean() - mm[mm.post == 0].fl.str.contains(f).mean(),
                     ci_lo=mm[mm.post == 0].fl.str.contains(f).mean(), ci_hi=mm[mm.post == 1].fl.str.contains(f).mean(), n=len(mm)))
tdid = pd.DataFrame(tdid)
tdid.to_csv(f"{out}/minister_teacher_did.csv", index=False)
print("\n== Ministering teacher-code DiD 2006-26 (design-weighted; flags rows give pre, post share in ci_lo, ci_hi) ==")
print(tdid.round(3).to_string(index=False))
mper = lab[lab.case.eq("MINISTER")].groupby("bin").apply(lambda g: pd.Series(dict(
    n=len(g), rel=g.rel.mean(), **{y: g[g.rel == 1][y].mean() for y in DIMS},
    **{f: g[g.rel == 1].fl.str.contains(f).mean() for f in "PCMH"}))).reset_index()
mper.to_csv(f"{out}/minister_teacher_periods.csv", index=False)

# ------------------------------------------------------------------ 7. Hierarchy: DiD by rank and rank x period means
rk_rows = []
for case in ["RACE", "MINISTER"]:
    p = panel(case, *SPECS[case][1][1:])
    p["post"] = (p.date >= BREAK[case]).astype(int)
    for rank in RANKS:
        q = p[p["rank"].eq(rank)]
        for y in DIMS:
            rk_rows.append(dict(case=case, rank=rank, outcome=y, **did(q, y)))
    for (rank, post), g in p[p.treat.eq(1) & p["rank"].isin(RANKS)].groupby(["rank", "post"]):
        for y in DIMS:
            rk_rows.append(dict(case=case, rank=rank, outcome=y + (" mean post" if post else " mean pre"), beta=np.average(g[y], weights=g.w), n=len(g)))
rk_rows = pd.DataFrame(rk_rows)
rk_rows.to_csv(f"{out}/rank_did.csv", index=False)
print("\n== DiD by speaker rank (full span) ==")
print(rk_rows[rk_rows.outcome.isin(DIMS)].pivot_table(index=["case", "rank"], columns="outcome", values="beta").round(3).to_string())

# Within-speaker ministering: speakers with likely-relevant ministering passages both 2006-17 and 2018-26 (student, p_rel >= 0.35)
pm = panel("MINISTER", "2006-01-01")
pm = pm[pm.treat.eq(1) & (pm.w >= 0.35)].assign(post=lambda x: (x.date >= BREAK["MINISTER"]).astype(int))
wm = pm.groupby(["speaker_n", "post"])[DIMS].mean().unstack()
cnt = pm.groupby(["speaker_n", "post"]).size().unstack()
keep = cnt.dropna().index
wm = wm.loc[keep]
diff = pd.DataFrame({y: wm[(y, 1)] - wm[(y, 0)] for y in DIMS})
diff.to_csv(f"{out}/minister_within_speaker.csv")
print(f"\n== Ministering within speaker (n={len(diff)} speakers on both sides): mean post-pre change ==")
print(diff.mean().round(3).to_dict(), "share positive:", (diff > 0).mean().round(2).to_dict())

# ------------------------------------------------------------------ 8. Lexical compliance and diffusion by rank (talk level)
talks = pd.read_parquet(talks_path, columns=["talk_id", "source", "date", "speaker", "text", "n_words", "procedural"])
talks = talks[talks.source.eq("General Conference") & ~talks.procedural]
ranks = pd.read_csv(ranks_path)[["talk_id", "rank", "woman", "speaker_n"]]
talks = talks.merge(ranks, on="talk_id", how="left")
talks["date"] = pd.to_datetime(talks.date)
talks["conf"] = talks.date.dt.strftime("%Y-%m")
low = talks.text.str.lower().str.replace("’", "'")
LEX = {
    "old_ht_vt": r"home teach|visiting teach",
    "ministering_program": r"\bministering\b(?! (of )?angel| spirit)",
    "mormon_name": r"\bmormons\b|\bmormonism\b|(?<!book of )\bmormon (church|people|pioneers?|tabernacle choir|faith|women|men|missionar\w*|families|family|culture|community|youth|members?|boys?|girls?|helping hands|newsroom|channel|messages)\b|\blds\b|\blds\.org|\bmormon\.org",
    "full_church_name": r"church of jesus christ of latter-day saints",
    "alike_unto_god": r"all are alike unto god|black and white, bond and free",
    "racism": r"\bracism\b|\bracist|\bracial prejudice|\bracial (and|or) ethnic",
    "every_worthy_male": r"every (faithful, )?worthy (man|male)|all worthy male",
}
for k, pat in LEX.items():
    talks[k] = low.str.count(pat)
lexi = talks.groupby(["conf", "rank"])[list(LEX)].apply(lambda g: (g > 0).mean()).join(talks.groupby(["conf", "rank"]).size().rename("talks")).reset_index()
lexi.to_csv(f"{out}/lexical_by_conf_rank.csv", index=False)
lexr = talks.groupby(["conf"])[list(LEX)].apply(lambda g: (g > 0).mean()).join(talks.groupby("conf").size().rename("talks")).reset_index()
lexr.to_csv(f"{out}/lexical_by_conf.csv", index=False)

def window_share(col, a, b, by="rank"):
    s = talks[(talks.date >= pd.Timestamp(a)) & (talks.date <= pd.Timestamp(b))]
    return s.groupby(by)[col].apply(lambda v: (v > 0).mean()), s.groupby(by).size()

comp = []
for col, wins in [("old_ht_vt", [("2014-01-01", "2017-12-31"), ("2018-03-01", "2019-12-31"), ("2020-01-01", "2022-12-31"), ("2023-01-01", "2026-12-31")]),
                  ("mormon_name", [("2014-01-01", "2018-06-30"), ("2018-09-01", "2019-12-31"), ("2020-01-01", "2022-12-31"), ("2023-01-01", "2026-12-31")]),
                  ("racism", [("2006-01-01", "2013-12-31"), ("2014-01-01", "2020-06-30"), ("2020-07-01", "2022-12-31"), ("2023-01-01", "2026-12-31")]),
                  ("alike_unto_god", [("1971-01-01", "1978-06-08"), ("1978-06-09", "1989-12-31"), ("1990-01-01", "2005-12-31"), ("2006-01-01", "2013-12-31"),
                                      ("2014-01-01", "2020-06-30"), ("2020-07-01", "2026-12-31")]),
                  ("every_worthy_male", [("1971-01-01", "1978-06-08"), ("1978-06-09", "1989-12-31"), ("1990-01-01", "2026-12-31")])]:
    for a, b in wins:
        sh, n = window_share(col, a, b)
        for r in RANKS:
            comp.append(dict(term=col, window=f"{a[:7]}..{b[:7]}", rank=r, share_of_talks=sh.get(r, np.nan), talks=n.get(r, 0)))
        sh2 = talks[(talks.date >= pd.Timestamp(a)) & (talks.date <= pd.Timestamp(b))][col].gt(0).mean()
        comp.append(dict(term=col, window=f"{a[:7]}..{b[:7]}", rank="ALL", share_of_talks=sh2,
                         talks=int(((talks.date >= pd.Timestamp(a)) & (talks.date <= pd.Timestamp(b))).sum())))
comp = pd.DataFrame(comp)
comp.to_csv(f"{out}/lexical_compliance.csv", index=False)
print("\n== Lexical use by rank (share of talks using the term) ==")
print(comp.pivot_table(index=["term", "window"], columns="rank", values="share_of_talks", sort=False).round(3).to_string())

# Who keeps using retired vocabulary after the change? Speakers and contexts (counts only, no text).
late = talks[(talks.date >= pd.Timestamp("2018-09-01")) & (talks.old_ht_vt > 0)]
late[["talk_id", "conf", "speaker", "rank", "old_ht_vt", "ministering_program"]].to_csv(f"{out}/late_old_vocab_talks.csv", index=False)
latem = talks[(talks.date >= pd.Timestamp("2018-11-01")) & (talks.mormon_name > 0)]
latem[["talk_id", "conf", "speaker", "rank", "mormon_name", "full_church_name"]].to_csv(f"{out}/late_mormon_talks.csv", index=False)
print("old HT/VT vocabulary after Sept 2018:", len(late), "talks;", late["rank"].value_counts().to_dict())
print("'Mormon' name usage after Oct 2018:", len(latem), "talks;", latem["rank"].value_counts().to_dict())

# First adopters of the 2020 anti-racism vocabulary, by rank
fa = talks[(talks.date >= pd.Timestamp("2020-07-01")) & (talks.racism > 0)].groupby("rank").conf.min()
print("first conference using 'racism' after June 2020, by rank:", fa.to_dict())
print("done")
