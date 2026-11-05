"""Aggregate passage scores into trends: by year, era and decade; talk-level PRRI categories; speakers; exemplars.

Usage: python3 -I cn_trends.py <cn_scores.parquet> <chunks.parquet> <labels_dir> <out_dir>
"""
import os
import sys

import numpy as np
import pandas as pd

sc_path, src, labels_dir, out = sys.argv[1:5]
sc = pd.read_parquet(sc_path)
SUPP = ["THEO", "AMER", "ANTI", "LIB"]
sc["period"] = np.select([sc.year <= 1886, sc.year.isin([1880, 1897]) & sc.source.eq("Conference Report"), sc.year == 1970],
                         [(sc.year // 5 * 5).astype(str), sc.year.astype(str), "1970"], (sc.year // 5 * 5).astype(str))
sc.loc[sc.source.eq("Conference Report") & sc.year.isin([1880, 1897]), "period"] = sc.year.astype(str) + " CR"


def agg(g):
    e_items = g.e_items.sum()
    d = {"passages": len(g), "talks": g.talk_id.nunique(), "words": int(g.n_words.sum()),
         "salience": g.p_any.mean(), "agree_share": g.p_agree.mean(), "disagree_share": g.p_disagree.mean(),
         "Q2_salience": g.p_Q2_any.mean(), "Q3_salience": g.p_Q3_any.mean(),
         "net_stance": (g.e_pos.sum() - g.e_neg.sum()) / e_items, "prri_equiv": g.e_prri.sum() / e_items,
         "agree_frac_of_addressed": g.p_agree.sum() / (g.p_agree.sum() + g.p_disagree.sum()),
         "endorse_per_10k": 1e4 * g.e_pos.sum() / g.n_words.sum(), "reject_per_10k": 1e4 * g.e_neg.sum() / g.n_words.sum()}
    for c in SUPP:
        d[c] = g["p_" + c + "_any"].mean()
    return pd.Series(d)


era_order = ["1850-69", "1870-86", "CR 1880/1897/1970", "1971-89", "1990-2009", "2010-26"]
by_era = sc.groupby("era").apply(agg).reindex(era_order)
by_year = sc.groupby("year").apply(agg)
by_period = sc.groupby("period").apply(agg)
by_period["sort"] = by_period.index.str[:4].astype(int) + by_period.index.str.contains("CR") * 0.5
by_period = by_period.sort_values("sort").drop(columns="sort")
by_source = sc.groupby("source").apply(agg)

# Talk-level PRRI-equivalent categories (talks expected to address at least half a passage's worth of items)
t = sc.groupby("talk_id").agg(year=("year", "first"), era=("era", "first"), speaker=("speaker", "first"), words=("n_words", "sum"),
                              e_any=("p_any", "sum"), e_items=("e_items", "sum"), e_prri=("e_prri", "sum"), e_pos=("e_pos", "sum"), e_neg=("e_neg", "sum"))
t["prri_equiv"] = t.e_prri / t.e_items
t["classified"] = t.e_any >= 0.5
t["category"] = pd.cut(t.prri_equiv, [0, 1.5, 2.5, 3.5, 5], right=False, labels=["Rejecter", "Skeptic", "Sympathizer", "Adherent"])
t.loc[~t.classified, "category"] = np.nan
cats = (t[t.classified].groupby("era").category.value_counts(normalize=False).unstack(fill_value=0).reindex(era_order))
cats["classified"] = cats.sum(1)
cats["talks"] = t.groupby("era").size().reindex(era_order)

# Speakers with at least 30,000 words
sp = sc.groupby("speaker").apply(agg)
sp = sp[sp.words >= 30_000].sort_values("endorse_per_10k", ascending=False)
yrs = sc.groupby("speaker").year.agg(["min", "max"])
sp = sp.join(yrs)

# Exemplars: highest raw agree / disagree passage per era, with a short excerpt
txt = pd.read_parquet(src, columns=["chunk_id", "text"]).set_index("chunk_id").text
lab_ids = set(pd.read_csv(os.path.join(labels_dir, "cn_sample_key.csv")).chunk_id)
ex = []
for era in era_order:
    g = sc[sc.era == era]
    for col in ("raw_agree", "raw_disagree"):
        for _, r in g.nlargest(3, col).iterrows():
            ex.append({"era": era, "kind": col[4:], "chunk_id": r.chunk_id, "year": r.year, "speaker": r.speaker,
                       "p": r["p_" + col[4:]], "labeled": r.chunk_id in lab_ids, "text": txt[r.chunk_id]})
ex = pd.DataFrame(ex)

# Design-weighted teacher estimates by era with bootstrap 90% intervals (round-1 sample)
o = pd.read_csv(os.path.join(out, "cn_oof_predictions.csv"))
o = o[o["round"] == 1]
rng = np.random.default_rng(5)
rows = []
for era in era_order:
    g = o[o.era == era]
    d = {"era": era, "n": len(g)}
    for c in ["any", "agree", "disagree", "AMER_any", "THEO_any", "ANTI_any", "LIB_any"]:
        est = np.average(g[c], weights=g.w)
        boots = [np.average(b[c], weights=b.w) for b in (g.sample(len(g), replace=True, random_state=int(rng.integers(1e9))) for _ in range(1000))]
        d[c], d[c + "_lo"], d[c + "_hi"] = est, np.quantile(boots, .05), np.quantile(boots, .95)
    Q = g[["Q1", "Q2", "Q3", "Q4", "Q5"]].values
    m = Q != 0
    d["teacher_net_stance_unweighted"] = Q[m].mean() if m.any() else np.nan
    d["teacher_items_addressed"] = int(m.sum())
    rows.append(d)
teach = pd.DataFrame(rows)

for name, df_ in [("cn_by_era", by_era), ("cn_by_year", by_year), ("cn_by_period", by_period), ("cn_by_source", by_source),
                  ("cn_talk_categories", cats), ("cn_speakers", sp), ("cn_teacher_by_era", teach.set_index("era"))]:
    df_.to_csv(os.path.join(out, name + ".csv"))
t.to_parquet(os.path.join(out, "cn_talk_scores.parquet"))
ex.to_json(os.path.join(out, "cn_exemplars.jsonl"), orient="records", lines=True, force_ascii=False)
pd.set_option("display.width", 250)
print(by_era.round(4).to_string())
print(by_period[["passages", "salience", "agree_share", "disagree_share", "net_stance", "prri_equiv", "endorse_per_10k", "AMER", "THEO", "ANTI", "LIB"]].round(4).to_string())
print(cats.to_string())
print(teach.round(3).to_string(index=False))
print(sp.head(15)[["words", "min", "max", "salience", "net_stance", "prri_equiv", "endorse_per_10k", "reject_per_10k"]].round(3).to_string())
