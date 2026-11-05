"""Christian nationalism student model: learn the teacher codes and score every passage in the corpus.

Positive codes are rare, so every target is a hurdle: the probability that a passage carries it (the
mean of a logistic regression on word TF-IDF + dense features and a gradient-boosted classifier on
SVD + dense features) times the target's mean coded value when present. Targets:

  agree     any PRRI item scored above zero (Q1-Q5)
  disagree  any PRRI item scored below zero
  any       any PRRI item addressed
  THEO, AMER, ANTI, LIB  supplemental codes (present = 1 or 2)
  Q2, Q3    item-level salience, the two items with enough coded passages

Raw probabilities come from models trained on samples that over-represent positives, so each is
calibrated by logistic regression on out-of-fold predictions: the slope from all labels, the intercept set so
the round-1 probability sample, weighted by inverse inclusion probability, matches the teacher
prevalence. Round-2 passages (chosen on model scores) enter training and the calibration slope only. Features are cached so later label rounds retrain in minutes.

Usage: python3 -I cn_student.py <chunks.parquet> <labels_dir> <glove.gz> <out_dir> <cache_dir>
"""
import gzip
import os
import re
import sys

import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler

src, labels_dir, glove_path, out, cache = sys.argv[1:6]
os.makedirs(out, exist_ok=True)
os.makedirs(cache, exist_ok=True)
SEED = 1776
ITEMS = ["Q1", "Q2", "Q3", "Q4", "Q5"]
SUPP = ["THEO", "AMER", "ANTI", "LIB"]

ch = pd.read_parquet(src)
ch = ch[~ch.procedural].reset_index(drop=True)
ch["era"] = pd.cut(ch.year, [1830, 1869, 1886, 1970, 1989, 2009, 2026],
                   labels=["1850-69", "1870-86", "CR 1880/1897/1970", "1971-89", "1990-2009", "2010-26"]).astype(str)
ch.loc[ch.source.eq("Conference Report"), "era"] = "CR 1880/1897/1970"
TERMS = r"\bamerica|united states|\bnation\b|\bnations\b|constitution|government|\bcountry\b|congress|christian|\bliberty\b|\blaws?\b|patriot|\bflag\b|founding|freedom"
low = ch.text.str.lower().str.replace("’", "'").str.replace(r"(\w) - (\w)", r"\1\2", regex=True)
ch["kw"] = low.str.count(TERMS)

LEX = {"america": r"\bameric", "us": r"united states|\bu\.\s?s\.", "constitution": r"constitution", "nation": r"\bnations?\b",
       "government": r"govern", "congress": r"congress|legislat|senat", "christian": r"christian", "liberty": r"\bliberty|freedom",
       "law": r"\blaws?\b|\blegal", "religion": r"religio", "kingdom": r"kingdom", "zion": r"\bzion", "babylon": r"babylon|gentile",
       "persecut": r"persecut|mob|oppress", "founders": r"founding|fathers of|washington|jefferson|lincoln|patriot",
       "promised": r"promised land|land of promise|choice (land|above)|swept off|ripe in iniquity",
       "polygamy": r"polygam|plural marriage|edmunds|monogam", "pluralism": r"all faiths|people of all|of every faith|conscience|religious freedom",
       "family": r"marriage|famil", "moral": r"moral|righteous|wicked"}

fx, fg, fi = (os.path.join(cache, f) for f in ("X_ridge.npz", "X_gb.npy", "chunk_id.npy"))
if os.path.exists(fx) and len(np.load(fi, allow_pickle=True)) == len(ch) and (np.load(fi, allow_pickle=True) == ch.chunk_id.values).all():
    Xridge, Xgb = sparse.load_npz(fx).tocsr(), np.load(fg)
    print("features loaded from cache")
else:
    nw = ch.n_words.clip(lower=50).values[:, None] / 100
    lex = np.column_stack([low.str.count(p).values for p in LEX.values()]) / nw
    vocab = set(w for t in low for w in re.findall(r"[a-z]+", t))
    gl = {}
    with gzip.open(glove_path, "rt", encoding="utf-8", errors="ignore") as f:
        for line in f:
            sp = line.rstrip().split(" ")
            if sp[0] in vocab and len(sp) == 101:
                gl[sp[0]] = np.asarray(sp[1:], dtype=np.float32)
    glv = np.vstack([np.mean([gl[w] for w in re.findall(r"[a-z]+", t) if w in gl] or [np.zeros(100, np.float32)], axis=0) for t in low])
    dense = np.hstack([np.log1p(lex), np.log(ch.n_words.values[:, None]), glv]).astype(np.float32)
    wv = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.5, sublinear_tf=True, max_features=200_000)
    Xw = wv.fit_transform(low)
    Z = TruncatedSVD(n_components=150, random_state=SEED).fit(Xw[np.random.default_rng(SEED).choice(Xw.shape[0], 20_000, replace=False)]).transform(Xw)
    D = StandardScaler().fit_transform(dense)
    Xridge = sparse.hstack([Xw, sparse.csr_matrix(D * 0.35)]).tocsr().astype(np.float32)
    Xgb = np.hstack([dense, Z]).astype(np.float32)
    sparse.save_npz(fx, Xridge)
    np.save(fg, Xgb)
    np.save(fi, ch.chunk_id.values)
    print("features built and cached")

# ---- Round-1 inclusion probabilities (make_sample.py design) ----
alloc = {"1850-69": 90, "1870-86": 90, "CR 1880/1897/1970": 30, "1971-89": 85, "1990-2009": 75, "2010-26": 80}
ch["pi"] = 0.0
for era, n in alloc.items():
    g = ch.era == era
    n_hot = int(round(n * 0.65))
    w = np.where(ch.kw[g] >= 2, ch.kw[g].clip(upper=12), 0).astype(float)
    p_hot = np.minimum(1, n_hot * w / w.sum())
    p_rand = (n - n_hot) / (g.sum() - n_hot)
    ch.loc[g, "pi"] = p_hot + (1 - p_hot) * p_rand

# ---- Labels ----
frames = []
for r, (lf, kf) in enumerate([("cn_labels.csv", "cn_sample_key.csv"), ("cn_labels2.csv", "cn_sample2_key.csv")], start=1):
    if os.path.exists(os.path.join(labels_dir, lf)):
        frames.append(pd.read_csv(os.path.join(labels_dir, lf)).merge(pd.read_csv(os.path.join(labels_dir, kf))[["lid", "chunk_id"]], on="lid").assign(round=r))
lab = pd.concat(frames, ignore_index=True)
pos = pd.Series(np.arange(len(ch)), index=ch.chunk_id)
li = pos.loc[lab.chunk_id].values
lab["era"] = ch.era.values[li]
lab["w"] = 1 / ch.pi.values[li]
Q = lab[ITEMS].values
lab["agree"] = (Q > 0).any(1).astype(int)
lab["disagree"] = (Q < 0).any(1).astype(int)
lab["any"] = (Q != 0).any(1).astype(int)
lab["pos_sum"] = np.where(Q > 0, Q, 0).sum(1)
lab["neg_sum"] = np.where(Q < 0, -Q, 0).sum(1)
lab["n_items"] = (Q != 0).sum(1)
lab["prri_sum"] = np.where(Q > 0, Q + 2, np.where(Q < 0, Q + 3, 0)).sum(1)  # -2->1, -1->2, +1->3, +2->4
for c in ["Q2", "Q3"]:
    lab[c + "_any"] = (lab[c] != 0).astype(int)
for c in SUPP:
    lab[c + "_any"] = (lab[c] > 0).astype(int)
TARGETS = ["agree", "disagree", "any", "Q2_any", "Q3_any"] + [c + "_any" for c in SUPP]
print(f"labels: {len(lab)} (round counts {lab['round'].value_counts().sort_index().to_dict()})")
print("positives:", {t: int(lab[t].sum()) for t in TARGETS})

GB = dict(max_iter=250, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0, min_samples_leaf=8, random_state=SEED)


def fit(rows, y):
    return (LogisticRegression(C=4.0, max_iter=5000, class_weight="balanced").fit(Xridge[rows], y),
            HistGradientBoostingClassifier(**GB).fit(Xgb[rows], y))


def predict(m, rows=None):
    a, b = (Xridge, Xgb) if rows is None else (Xridge[rows], Xgb[rows])
    return (m[0].predict_proba(a)[:, 1] + m[1].predict_proba(b)[:, 1]) / 2


class Platt:
    """Logistic calibration on logit(raw). The slope is fit on all teacher labels (out-of-fold), where
    positives are numerous; the intercept is then set so the design-weighted mean over the round-1
    probability sample equals the design-weighted teacher prevalence (a prior-shift correction for the
    oversampling of signal passages). This keeps the model's ranking instead of collapsing it."""

    def fit(self, p_all, y_all, p1, y1, w1):
        from scipy.optimize import brentq
        self.a = LogisticRegression(C=100.0).fit(self._z(p_all), y_all).coef_[0, 0]
        target = np.average(y1, weights=w1)
        f = lambda b: np.average(1 / (1 + np.exp(-(self.a * self._z(p1)[:, 0] + b))), weights=w1) - target
        self.b = brentq(f, -30, 30)
        return self

    @staticmethod
    def _z(p):
        p = np.clip(p, 1e-4, 1 - 1e-4)
        return np.log(p / (1 - p))[:, None]

    def predict(self, p):
        return 1 / (1 + np.exp(-(self.a * self._z(p)[:, 0] + self.b)))


strat = lab["any"] * 2 + lab[[c + "_any" for c in SUPP]].any(axis=1)
# Direction among addressed passages: 1 if the passage's positive item scores outweigh its negative ones.
lab["dir"] = np.where(lab.pos_sum > lab.neg_sum, 1.0, np.where(lab.neg_sum > lab.pos_sum, 0.0, np.nan))
has_dir = lab["any"].eq(1).values & lab["dir"].notna().values
oof = pd.DataFrame(index=lab.index, columns=TARGETS, dtype=float)
oof_dir = np.zeros(len(lab))
for tr, te in StratifiedKFold(5, shuffle=True, random_state=SEED).split(li, strat):
    for t in TARGETS:
        oof.loc[te, t] = predict(fit(li[tr], lab[t].values[tr]), li[te])
    trd = tr[has_dir[tr]]
    oof_dir[te] = predict(fit(li[trd], lab["dir"].values[trd].astype(int)), li[te])

r1 = lab["round"].eq(1).values
cal, rep = {}, []
for t in TARGETS:
    y, p = lab[t].values, oof[t].values
    cal[t] = Platt().fit(p, y, p[r1], y[r1], lab.w.values[r1])
    rep.append({"target": t, "positives": int(y.sum()), "auc": roc_auc_score(y, p), "avg_precision": average_precision_score(y, p),
                "base_rate": y.mean(), "cal_slope": cal[t].a, "auc_round1": roc_auc_score(y[r1], p[r1]) if y[r1].sum() > 2 else np.nan,
                "weighted_prevalence_round1": np.average(y[r1], weights=lab.w.values[r1])})
yd = lab["dir"].values[has_dir].astype(int)
rep.append({"target": "direction|addressed", "positives": int(yd.sum()), "auc": roc_auc_score(yd, oof_dir[has_dir]),
            "avg_precision": average_precision_score(yd, oof_dir[has_dir]), "base_rate": yd.mean(),
            "auc_round1": roc_auc_score(yd[r1[has_dir]], oof_dir[has_dir][r1[has_dir]]),
            "weighted_prevalence_round1": np.average(yd[r1[has_dir]], weights=lab.w.values[has_dir & r1])})
rep = pd.DataFrame(rep)
print(rep.round(3).to_string(index=False))

# ---- Final models: score all passages ----
sc = ch[["chunk_id", "talk_id", "source", "year", "era", "speaker", "n_words", "kw"]].copy()
for t in TARGETS:
    raw = predict(fit(li, lab[t].values))
    sc["raw_" + t] = raw.astype(np.float32)
    sc["p_" + t] = cal[t].predict(raw).astype(np.float32)
# Stance = salience x direction: P(agree) = P(addressed) * P(agree | addressed). The direct agree/disagree
# hurdles are kept for comparison; the decomposition is used because the direct agree model ranks poorly
# within the probability sample (positives are rare and varied) while salience and direction are each well learned.
sc["p_dir"] = predict(fit(li[has_dir], lab["dir"].values[has_dir].astype(int))).astype(np.float32)
sc["p_agree_direct"], sc["p_disagree_direct"] = sc.p_agree, sc.p_disagree
sc["p_agree"] = (sc.p_any * sc.p_dir).astype(np.float32)
sc["p_disagree"] = (sc.p_any * (1 - sc.p_dir)).astype(np.float32)

# Conditional means when present, from the teacher codes (pooled over rounds)
cm = {"pos_sum": lab.loc[lab.agree == 1, "pos_sum"].mean(), "neg_sum": lab.loc[lab.disagree == 1, "neg_sum"].mean(),
      "agree_items": (Q > 0).sum(1)[lab.agree == 1].mean(), "disagree_items": (Q < 0).sum(1)[lab.disagree == 1].mean(),
      "agree_prri": np.where(Q > 0, Q + 2, 0).sum(1)[lab.agree == 1].mean(),
      "disagree_prri": np.where(Q < 0, Q + 3, 0).sum(1)[lab.disagree == 1].mean()}
for c in SUPP:
    cm[c] = lab.loc[lab[c] > 0, c].mean()
print("conditional means:", {k: round(v, 3) for k, v in cm.items()})
sc["e_pos"] = sc.p_agree * cm["pos_sum"]
sc["e_neg"] = sc.p_disagree * cm["neg_sum"]
sc["e_items"] = sc.p_agree * cm["agree_items"] + sc.p_disagree * cm["disagree_items"]
sc["e_prri"] = sc.p_agree * cm["agree_prri"] + sc.p_disagree * cm["disagree_prri"]
for c in SUPP:
    sc["e_" + c] = sc["p_" + c + "_any"] * cm[c]

sc.to_parquet(os.path.join(out, "cn_scores.parquet"), index=False)
o = lab[["lid", "chunk_id", "round", "era", "w"] + ITEMS + SUPP + TARGETS].copy()
for t in TARGETS:
    o["oof_" + t] = oof[t].values
o["oof_dir"] = oof_dir
for t in TARGETS:  # calibrated out-of-fold values, for model-assisted (difference) estimation downstream
    o["s_" + t] = cal[t].predict(oof[t].values)
o["s_agree"] = o.s_any * oof_dir
o["s_disagree"] = o.s_any * (1 - oof_dir)
o.to_csv(os.path.join(out, "cn_oof_predictions.csv"), index=False)
rep.to_csv(os.path.join(out, "cn_validation.csv"), index=False)
pd.Series(cm).to_csv(os.path.join(out, "cn_conditional_means.csv"), header=["value"])

# Design-weighted teacher estimates vs calibrated student, by era (round-1 sample only)
L1 = lab[r1].assign(**{"s_" + t: cal[t].predict(oof[t].values[r1]) for t in TARGETS})
L1["s_agree"] = L1.s_any * oof_dir[r1]
L1["s_disagree"] = L1.s_any * (1 - oof_dir[r1])
rows = []
for era, g in L1.groupby("era"):
    d = {"era": era, "n": len(g)}
    for t in ["any", "agree", "disagree", "AMER_any", "THEO_any", "ANTI_any", "LIB_any"]:
        d["teacher_" + t] = np.average(g[t], weights=g.w)
        d["student_" + t] = np.average(g["s_" + t], weights=g.w)
    rows.append(d)
byera = pd.DataFrame(rows)
byera.to_csv(os.path.join(out, "cn_validation_by_era.csv"), index=False)
print(byera.round(3).to_string(index=False))
print("population means:", sc[["p_" + t for t in TARGETS] + ["p_agree_direct", "p_disagree_direct", "p_dir"]].mean().round(4).to_dict())
print(sc.groupby("era")[["p_any", "p_agree", "p_disagree", "p_agree_direct", "p_disagree_direct"]].mean().round(4).to_string())
