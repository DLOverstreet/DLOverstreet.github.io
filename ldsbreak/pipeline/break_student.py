"""Student model for the breakpoint study: learn the 744 teacher codes and score every passage in the corpus.

Targets
  rel      passage substantively engages its candidate topic (classifier; mean of a logistic regression on word
           TF-IDF, a gradient-boosted classifier on SVD + GloVe + lexicon features, and a logistic regression on
           the candidate topic's dictionary hits; every learner also sees the candidate-topic hit features)
  D1..D4   rhetoric dimensions on the -1..+1 scale (mean of ridge regression and gradient-boosted regression)

Validation is 5-fold cross-validation stratified by topic. Regression outputs shrink toward the mean, so each
dimension is linearly recalibrated to the teacher scale with the slope and intercept of teacher-on-out-of-fold
predictions (this undoes attenuation in effect sizes; it does not change any ranking or test statistic).

Features are the cached CN-project matrices (same row order as topics.py: non-procedural chunks).

Usage: python3 -I break_student.py <topics.parquet> <labels_dir> <cache_dir> <out_dir>
"""
import os
import sys

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.stats import pearsonr
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

tp, labels_dir, cache, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
SEED = 1978
DIMS = ["D1", "D2", "D3", "D4"]

t = pd.read_parquet(tp)
ids = np.load(os.path.join(cache, "chunk_id.npy"), allow_pickle=True)
assert len(ids) == len(t) and (ids == t.chunk_id.values).all(), "feature cache does not match topics.parquet"
Xr = sparse.load_npz(os.path.join(cache, "X_ridge.npz")).tocsr()
Xg = np.load(os.path.join(cache, "X_gb.npy"))

lab = pd.read_csv(os.path.join(labels_dir, "break_labels.csv")).merge(
    pd.read_csv(os.path.join(labels_dir, "break_sample_key.csv"))[["lid", "chunk_id", "case", "topic", "source"]], on="lid")
pos = pd.Series(np.arange(len(t)), index=t.chunk_id)
li = pos.loc[lab.chunk_id].values
print(f"labels: {len(lab)}; rel=1 {int(lab.rel.sum())}")

GBR = dict(max_iter=300, learning_rate=0.04, max_leaf_nodes=15, l2_regularization=1.0, min_samples_leaf=10, random_state=SEED)


def fit_reg(rows, y):
    return Ridge(alpha=3.0).fit(Xr[rows], y), HistGradientBoostingRegressor(**GBR).fit(Xg[rows], y)


def pred_reg(m, rows=None):
    a, b = (Xr, Xg) if rows is None else (Xr[rows], Xg[rows])
    return (m[0].predict(a) + m[1].predict(b)) / 2


TOP = ["RACE", "MINISTER", "MISSION", "TEMPLE", "LAMANITE", "TITHING", "WOW", "SABBATH", "PRAYER", "WELFARE", "CHASTITY"]
H = np.log1p(t[["hits_" + x for x in TOP]].values.astype(float))
RS = np.log1p(t.race_strong.values.astype(float))


def meta(rows, topic):
    """Relevance depends on the candidate topic: its dictionary hits, strong race terms, and a topic indicator."""
    k = np.array([TOP.index(x) if x in TOP else -1 for x in topic])
    cand = np.where(k >= 0, H[rows, np.clip(k, 0, None)], 0.0)
    oh = (k[:, None] == np.arange(len(TOP))[None, :]).astype(float)
    return np.column_stack([cand, RS[rows], H[rows], oh, oh * cand[:, None]])


def fit_clf(rows, y, topic):
    M = meta(rows, topic)
    return (LogisticRegression(C=4.0, max_iter=5000, class_weight="balanced").fit(sparse.hstack([Xr[rows], sparse.csr_matrix(M)]).tocsr(), y),
            HistGradientBoostingClassifier(**GBR).fit(np.hstack([Xg[rows], M]), y),
            LogisticRegression(C=1.0, max_iter=5000, class_weight="balanced").fit(M, y))


def pred_clf(m, rows, topic):
    M = meta(rows, topic)
    return (m[0].predict_proba(sparse.hstack([Xr[rows], sparse.csr_matrix(M)]).tocsr())[:, 1]
            + m[1].predict_proba(np.hstack([Xg[rows], M]))[:, 1] + m[2].predict_proba(M)[:, 1]) / 3


oof = pd.DataFrame(index=lab.index, columns=["rel"] + DIMS, dtype=float)
strat = lab.topic.astype("category").cat.codes * 2 + lab.rel
for tr, te in StratifiedKFold(5, shuffle=True, random_state=SEED).split(li, strat):
    oof.loc[te, "rel"] = pred_clf(fit_clf(li[tr], lab.rel.values[tr], lab.topic.values[tr]), li[te], lab.topic.values[te])
    for d in DIMS:
        oof.loc[te, d] = pred_reg(fit_reg(li[tr], lab[d].values[tr]), li[te])

rep, cal = [], {}
rep.append({"target": "rel", "subset": "all", "n": len(lab), "metric": "AUC", "value": roc_auc_score(lab.rel, oof.rel)})
for case in ["RACE", "MINISTER", "CONTROL"]:
    s = lab.case.eq(case)
    rep.append({"target": "rel", "subset": case, "n": int(s.sum()), "metric": "AUC", "value": roc_auc_score(lab.rel[s], oof.rel[s])})
for d in DIMS:
    lr = LinearRegression().fit(oof[[d]].values, lab[d].values)
    cal[d] = (float(lr.intercept_), float(lr.coef_[0]))
    for name, s in [("all", lab.index == lab.index), ("rel=1", lab.rel.eq(1)), ("RACE", lab.case.eq("RACE")),
                    ("RACE rel=1", lab.case.eq("RACE") & lab.rel.eq(1)), ("MINISTER", lab.case.eq("MINISTER")),
                    ("CONTROL", lab.case.eq("CONTROL"))]:
        r = pearsonr(lab.loc[s, d], oof.loc[s, d])[0] if lab.loc[s, d].std() > 0 else np.nan
        rep.append({"target": d, "subset": name, "n": int(s.sum()), "metric": "r", "value": r})
rep = pd.DataFrame(rep)
rep.to_csv(os.path.join(out, "student_cv.csv"), index=False)
print(rep.pivot_table(index=["target", "metric"], columns="subset", values="value").round(3).to_string())
print("recalibration (intercept, slope):", {d: tuple(round(v, 2) for v in cal[d]) for d in DIMS})
oof.add_prefix("oof_").assign(lid=lab.lid.values).to_csv(os.path.join(out, "student_oof.csv"), index=False)

sc = t[["chunk_id"]].copy()
mrel = fit_clf(li, lab.rel.values, lab.topic.values)
allr = np.arange(len(t))
sc["p_rel"] = pred_clf(mrel, allr, t.primary.values).astype(np.float32)  # candidate topic = primary topic
for x in ["RACE", "MINISTER"]:
    sc["p_rel_" + x] = pred_clf(mrel, allr, np.repeat(x, len(t))).astype(np.float32)
for d in DIMS:
    raw = pred_reg(fit_reg(li, lab[d].values))
    a, b = cal[d]
    sc[d] = np.clip(a + b * raw, -1, 1).astype(np.float32)
sc.to_parquet(os.path.join(out, "break_scores.parquet"), index=False)
print("scored", len(sc), "passages;", sc[["p_rel"] + DIMS].describe().round(3).to_string())
