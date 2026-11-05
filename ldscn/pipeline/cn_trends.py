"""Turn passage scores into trend estimates.

1. Era levels (salience, agree, disagree, supplemental codes): a model-assisted difference estimator,
   population mean of the calibrated student score plus the design-weighted mean teacher-minus-student
   residual in the round-1 probability sample. Design-unbiased; 90% intervals by bootstrap over labeled
   passages. Shown beside the pure teacher (Horvitz-Thompson) and pure student estimates.
2. Stance among addressed passages by era, from the teacher codes (both rounds) and from the model.
3. Within-era change: passages the student flags with high confidence (threshold on the raw salience
   score set for >= 60% out-of-fold precision), per 1,000 passages by five-year period, split by
   predicted direction.
4. Talk-level PRRI-equivalent categories, speakers, exemplars.

Usage: python3 -I cn_trends.py <cn_scores.parquet> <chunks.parquet> <labels_dir> <out_dir>
"""
import os
import sys

import numpy as np
import pandas as pd

sc_path, src, labels_dir, out = sys.argv[1:5]
sc = pd.read_parquet(sc_path)
sc = sc[sc.year.notna()].copy()  # 137 JoD passages whose discourse carries no date
sc["year"] = sc.year.astype(int)
o = pd.read_csv(os.path.join(out, "cn_oof_predictions.csv"))
cm = pd.read_csv(os.path.join(out, "cn_conditional_means.csv"), index_col=0)["value"]
ERAS = ["1850-69", "1870-86", "CR 1880/1897/1970", "1971-89", "1990-2009", "2010-26"]
ITEMS = ["Q1", "Q2", "Q3", "Q4", "Q5"]
TGT = ["any", "agree", "disagree", "Q2_any", "Q3_any", "THEO_any", "AMER_any", "ANTI_any", "LIB_any"]
rng = np.random.default_rng(5)
B = 2000
pd.set_option("display.width", 250)

# ---- 1. Era levels ----
r1 = o[o["round"] == 1]
rows = []
for era in ERAS:
    g, pop = r1[r1.era == era], sc[sc.era == era]
    boots = [g.iloc[rng.integers(0, len(g), len(g))] for _ in range(B)]
    for t in TGT:
        s_pop = pop["p_" + t].mean()
        resid = g[t] - g["s_" + t]
        est = s_pop + np.average(resid, weights=g.w)
        bt = np.array([s_pop + np.average(b[t] - b["s_" + t], weights=b.w) for b in boots])
        ht = np.array([np.average(b[t], weights=b.w) for b in boots])
        rows.append({"era": era, "target": t, "passages": len(pop), "student": s_pop, "teacher_ht": np.average(g[t], weights=g.w),
                     "teacher_lo": np.quantile(ht, .05), "teacher_hi": np.quantile(ht, .95),
                     "model_assisted": max(est, 0), "lo": max(np.quantile(bt, .05), 0), "hi": np.quantile(bt, .95), "n_labeled": len(g)})
era_lv = pd.DataFrame(rows)
wide = era_lv.pivot(index="era", columns="target", values="model_assisted").reindex(ERAS)[TGT]

# ---- 2. Stance among addressed passages ----
lab = o.copy()
addr = lab[lab["any"] == 1].copy()
Qa = addr[ITEMS].values.astype(float)
addr["prri_mean"] = np.nanmean(np.where(Qa != 0, np.where(Qa > 0, Qa + 2, Qa + 3), np.nan), axis=1)
addr["item_mean"] = np.nanmean(np.where(Qa != 0, Qa, np.nan), axis=1)
st = []
for era in ERAS:
    g = addr[addr.era == era]
    bt = [g.iloc[rng.integers(0, len(g), len(g))] for _ in range(B)]
    d = {"era": era, "addressed_coded": len(g), "agree_coded": int(g.agree.sum()), "disagree_coded": int(g.disagree.sum()),
         "teacher_prri": g.prri_mean.mean(), "teacher_prri_lo": np.quantile([b.prri_mean.mean() for b in bt], .05),
         "teacher_prri_hi": np.quantile([b.prri_mean.mean() for b in bt], .95), "teacher_item_mean": g.item_mean.mean(),
         "model_agree_share": wide.loc[era, "agree"] / (wide.loc[era, "agree"] + wide.loc[era, "disagree"])}
    for it in ITEMS:
        d[it + "+"], d[it + "-"] = int((g[it] > 0).sum()), int((g[it] < 0).sum())
    st.append(d)
stance = pd.DataFrame(st).set_index("era")
# PRRI-equivalent implied by the model: agree passages score ~3.2 per item, disagree ~1.75 (teacher means)
a_item, d_item = cm["agree_prri"] / cm["agree_items"], cm["disagree_prri"] / cm["disagree_items"]
stance["model_prri"] = stance.model_agree_share * a_item + (1 - stance.model_agree_share) * d_item

# ---- 3. Flagged passages by five-year period ----
cand = np.sort(o.oof_any.unique())
prec = np.array([o.loc[o.oof_any >= c, "any"].mean() for c in cand])
thr = cand[np.argmax(prec >= 0.6)] if (prec >= 0.6).any() else np.quantile(o.oof_any, .9)
f = o.oof_any >= thr
flag_val = {"threshold": thr, "precision_all": o.loc[f, "any"].mean(), "recall_all": o.loc[f, "any"].sum() / o["any"].sum(),
            "n_flagged_labeled": int(f.sum())}
for era in ERAS:
    g = o[o.era == era]
    ff = g.oof_any >= thr
    flag_val["precision_" + era] = g.loc[ff, "any"].mean() if ff.any() else np.nan
    flag_val["n_flagged_" + era] = int(ff.sum())
    dd = g[ff & g["any"].eq(1)]
    flag_val["direction_acc_" + era] = ((dd.oof_dir >= .5) == (dd.agree > dd.disagree)).mean() if len(dd) else np.nan
sc["flag"] = sc.raw_any >= thr
sc["flag_agree"] = sc.flag & (sc.p_dir >= .5)
sc["flag_disagree"] = sc.flag & (sc.p_dir < .5)
is_cr = sc.source.eq("Conference Report")
sc["period"] = np.where(is_cr, sc.year.astype(str) + " CR", (sc.year // 5 * 5).astype(str))
sc.loc[sc.year < 1850, "period"] = "1850"  # a handful of 1830s-40s discourses printed in the JoD, pooled with 1850-54
per = sc.groupby("period").agg(year=("year", "min"), passages=("chunk_id", "size"), talks=("talk_id", "nunique"), words=("n_words", "sum"),
                               flagged=("flag", "sum"), flag_agree=("flag_agree", "sum"), flag_disagree=("flag_disagree", "sum"),
                               salience=("p_any", "mean"), AMER=("p_AMER_any", "mean"), THEO=("p_THEO_any", "mean"),
                               ANTI=("p_ANTI_any", "mean"), LIB=("p_LIB_any", "mean"))
per = per.sort_values("year")
for c in ["flagged", "flag_agree", "flag_disagree"]:
    per[c + "_per1000"] = 1000 * per[c] / per.passages
per["agree_share_flagged"] = per.flag_agree / per.flagged

# ---- 4. Talks, speakers, exemplars ----
sc["exp_prri"] = sc.p_dir * a_item + (1 - sc.p_dir) * d_item
fl = sc[sc.flag]
talks = fl.groupby("talk_id").agg(year=("year", "first"), era=("era", "first"), speaker=("speaker", "first"),
                                  flagged=("flag", "sum"), prri=("exp_prri", "mean"))
talks["category"] = pd.cut(talks.prri, [0, 1.5, 2.5, 3.5, 5], right=False, labels=["Rejecter", "Skeptic", "Sympathizer", "Adherent"])
cats = talks.groupby("era").category.value_counts().unstack(fill_value=0).reindex(ERAS)
cats["talks_classified"] = cats.sum(1)
cats["talks_total"] = sc.groupby("era").talk_id.nunique().reindex(ERAS)
cats["share_classified"] = cats.talks_classified / cats.talks_total

sp = sc.groupby("speaker").agg(words=("n_words", "sum"), first=("year", "min"), last=("year", "max"), flagged=("flag", "sum"),
                               agree=("flag_agree", "sum"), disagree=("flag_disagree", "sum"), salience=("p_any", "mean"))
sp = sp[sp.words >= 30_000]
sp["flagged_per_100k"] = 1e5 * sp.flagged / sp.words
sp["agree_per_100k"] = 1e5 * sp.agree / sp.words
sp["disagree_per_100k"] = 1e5 * sp.disagree / sp.words
sp = sp.sort_values("agree_per_100k", ascending=False)

txt = pd.read_parquet(src, columns=["chunk_id", "text", "date"]).set_index("chunk_id")
labeled = set(o.chunk_id)
ex = []
for era in ERAS:
    g = fl[fl.era == era]
    for kind, gg in (("agree", g[g.p_dir >= .5].nlargest(4, "raw_any")), ("disagree", g[g.p_dir < .5].nlargest(4, "raw_any"))):
        for _, r in gg.iterrows():
            ex.append({"era": era, "kind": kind, "chunk_id": r.chunk_id, "year": int(r.year), "speaker": r.speaker, "p_dir": float(r.p_dir),
                       "raw_any": float(r.raw_any), "teacher_coded": r.chunk_id in labeled, "text": txt.text[r.chunk_id]})
ex = pd.DataFrame(ex)

era_lv.to_csv(os.path.join(out, "cn_era_estimates_long.csv"), index=False)
wide.to_csv(os.path.join(out, "cn_era_estimates.csv"))
stance.to_csv(os.path.join(out, "cn_era_stance.csv"))
per.to_csv(os.path.join(out, "cn_by_period.csv"))
pd.Series(flag_val).to_csv(os.path.join(out, "cn_flag_validation.csv"), header=["value"])
cats.to_csv(os.path.join(out, "cn_talk_categories.csv"))
talks.to_csv(os.path.join(out, "cn_flagged_talks.csv"))
sp.to_csv(os.path.join(out, "cn_speakers.csv"))
ex.to_json(os.path.join(out, "cn_exemplars.jsonl"), orient="records", lines=True, force_ascii=False)

print(era_lv[era_lv.target.isin(["any", "agree", "disagree"])].round(4).to_string(index=False))
print(wide.round(4).to_string())
print(stance.round(3).to_string())
print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in flag_val.items()})
print(per[["passages", "flagged_per1000", "flag_agree_per1000", "flag_disagree_per1000", "agree_share_flagged", "AMER", "THEO", "ANTI", "LIB"]].round(3).to_string())
print(cats.to_string())
print(sp.head(12)[["words", "first", "last", "flagged", "agree", "disagree", "agree_per_100k", "disagree_per_100k"]].round(1).to_string())
print(sp.sort_values("disagree_per_100k", ascending=False).head(8)[["words", "first", "last", "agree_per_100k", "disagree_per_100k"]].round(1).to_string())
