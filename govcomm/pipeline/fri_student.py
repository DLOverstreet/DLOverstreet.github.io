"""Fascist Rhetoric Index: train student models on the FRI teacher labels and score every post.

Markers are rare, so each marker uses a hurdle model: the probability the marker is present (the
mean of a logistic regression on word + character TF-IDF and dense features and a gradient-boosted
classifier on dense + SVD features, the same inputs as student.py) times the marker's mean coded
strength when present. The 0-100 index is the sum of the seven expected scores, calibrated to the
teacher codes by isotonic regression on out-of-fold predictions, so that group means match the
coder's scale; marker scores are rescaled to sum to the calibrated index. A logistic model, also
isotonic-calibrated, gives each post's probability of being a syndrome post (three or more markers,
at least one core marker). Features are cached so later label rounds retrain in minutes.

Usage: python3 -I fri_student.py <corpus.parquet> <labels_dir> <glove.gz> <out_dir> <cache_dir>
"""
import os
import sys

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.stats import pearsonr, spearmanr
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import KFold, StratifiedKFold
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import clean_for_model, glove_mean, load_glove, style_features, unit_text  # noqa: E402

corpus_path, labels_dir, glove_path, out, cache = sys.argv[1:6]
MARKERS = ["RE", "EN", "DH", "LC", "AD", "VI", "VG"]
CORE = ["EN", "DH", "AD", "VI"]
rng = 1945
os.makedirs(out, exist_ok=True)
os.makedirs(cache, exist_ok=True)

df = pd.read_parquet(corpus_path, columns=["post_id", "platform", "title", "text"])
fx, fg, fi = (os.path.join(cache, f) for f in ("X_ridge.npz", "X_gb.npy", "post_id.npy"))
if os.path.exists(fx) and (np.load(fi, allow_pickle=True) == df.post_id.values).all():
    Xridge, Xgb = sparse.load_npz(fx).tocsr(), np.load(fg)
    print("features loaded from cache")
else:
    from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
    unit = [unit_text(p, t, x) for p, t, x in zip(df.platform, df.title, df.text)]
    mtext = pd.Series(unit).map(clean_for_model)
    sia = SentimentIntensityAnalyzer()
    style = np.array([style_features(t) for t in unit], dtype=np.float32)
    vad = np.array([[v["neg"], v["neu"], v["pos"], v["compound"]] for v in map(sia.polarity_scores, mtext)], dtype=np.float32)
    gl = load_glove(glove_path, set(w for t in mtext.str.lower() for w in t.split()))
    glv = np.vstack([glove_mean(t, gl) for t in mtext])
    dense = np.hstack([style, vad, glv])
    wv = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.5, sublinear_tf=True, max_features=150_000)
    cv = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=5, sublinear_tf=True, max_features=150_000, lowercase=False)
    Xw, Xc = wv.fit_transform(mtext), cv.fit_transform(mtext)
    samp = np.random.default_rng(rng).choice(Xw.shape[0], 30_000, replace=False)
    Z = TruncatedSVD(n_components=100, random_state=rng).fit(Xw[samp]).transform(Xw)
    D = StandardScaler().fit_transform(dense)
    Xridge = sparse.hstack([Xw, Xc, sparse.csr_matrix(D * 0.35)]).tocsr().astype(np.float32)
    Xgb = np.hstack([dense, Z]).astype(np.float32)
    sparse.save_npz(fx, Xridge)
    np.save(fg, Xgb)
    np.save(fi, df.post_id.values)
    print("features built and cached")

# Teacher labels: the stratified round (F*) and the score-selected rounds (G*, H*).
frames = []
for lf, kf_ in (("fri_labels.csv", "fri_sample_key.csv"), ("fri_labels2.csv", "fri_sample2_key.csv"), ("fri_labels3.csv", "fri_sample3_key.csv")):
    if os.path.exists(os.path.join(labels_dir, lf)):
        k = pd.read_csv(os.path.join(labels_dir, kf_))
        frames.append(pd.read_csv(os.path.join(labels_dir, lf)).merge(k[["lid", "post_id", "stratum"]], on="lid"))
lab = pd.concat(frames, ignore_index=True)
idx = pd.Series(np.arange(len(df)), index=df.post_id)
li = idx.loc[lab.post_id].values
Y = lab[MARKERS].values.astype(float)
lab["fri"] = 100 * Y.sum(1) / 14
lab["n_present"] = (Y > 0).sum(1)
lab["syndrome"] = ((lab.n_present >= 3) & (lab[CORE] > 0).any(axis=1)).astype(int)
print(f"labels: {len(lab)}  presence rates: {dict(zip(MARKERS, (Y > 0).mean(0).round(3)))}  syndrome: {lab.syndrome.sum()}")

GB = dict(max_iter=300, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0, min_samples_leaf=10, random_state=rng)


def fit_marker(rows, y):
    pres = (y > 0).astype(int)
    return (LogisticRegression(C=8.0, max_iter=5000).fit(Xridge[rows], pres),
            HistGradientBoostingClassifier(**GB).fit(Xgb[rows], pres), y[y > 0].mean())


def predict_marker(models, rows=None):
    lr, gb, level = models
    a, b = (Xridge, Xgb) if rows is None else (Xridge[rows], Xgb[rows])
    return (lr.predict_proba(a)[:, 1] + gb.predict_proba(b)[:, 1]) / 2 * level


def fit_syn(rows, y):
    return LogisticRegression(C=2.0, max_iter=5000).fit(Xridge[rows], y)


def iso(x, y):
    return IsotonicRegression(y_min=0, out_of_bounds="clip").fit(x, y)


def crossfit(x, y):
    """Honest calibrated values for reporting: isotonic fit on four folds of OOF predictions, applied to the fifth."""
    out = np.zeros_like(x)
    for a, b in KFold(5, shuffle=True, random_state=3).split(x):
        out[b] = iso(x[a], y[a]).predict(x[b])
    return out


# Cross-validation, stratified on any-marker presence so every fold sees positives.
strat = (lab.n_present > 0).astype(int) + lab.syndrome
skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=rng)
oof = np.zeros_like(Y)
oof_syn = np.zeros(len(lab))
for tr, te in skf.split(li, strat):
    for j in range(len(MARKERS)):
        oof[te, j] = predict_marker(fit_marker(li[tr], Y[tr, j]), li[te])
    oof_syn[te] = fit_syn(li[tr], lab.syndrome.values[tr]).predict_proba(Xridge[li[te]])[:, 1]
oof_raw = 100 * oof.sum(1) / 14
oof_fri = crossfit(oof_raw, lab.fri.values)
oof_syn_raw = oof_syn.copy()
oof_syn = crossfit(oof_syn_raw, lab.syndrome.values.astype(float))

rep = []
for j, m in enumerate(MARKERS):
    pres = (Y[:, j] > 0).astype(int)
    rep.append({"marker": m, "n_present": int(pres.sum()), "teacher_mean": Y[:, j].mean(), "student_mean_oof": oof[:, j].mean(),
                "r": pearsonr(Y[:, j], oof[:, j])[0], "auc_presence": roc_auc_score(pres, oof[:, j]),
                "avg_precision": average_precision_score(pres, oof[:, j]), "base_rate": pres.mean()})
rep.append({"marker": "FRI", "n_present": int((lab.n_present > 0).sum()), "teacher_mean": lab.fri.mean(), "student_mean_oof": oof_fri.mean(),
            "r": pearsonr(lab.fri, oof_fri)[0], "rho": spearmanr(lab.fri, oof_fri)[0],
            "auc_presence": roc_auc_score(lab.n_present > 0, oof_fri), "avg_precision": average_precision_score(lab.n_present > 0, oof_fri),
            "base_rate": (lab.n_present > 0).mean()})
rep.append({"marker": "Syndrome", "n_present": int(lab.syndrome.sum()), "teacher_mean": lab.syndrome.mean(), "student_mean_oof": oof_syn.mean(),
            "r": pearsonr(lab.syndrome, oof_syn)[0], "auc_presence": roc_auc_score(lab.syndrome, oof_syn_raw),
            "avg_precision": average_precision_score(lab.syndrome, oof_syn_raw), "base_rate": lab.syndrome.mean()})
rep = pd.DataFrame(rep)
print(rep.round(3).to_string(index=False))

# Agreement by stratum: does the student reproduce the teacher's group means?
lab["fri_oof"] = oof_fri
lab["syn_oof"] = oof_syn
by = lab.groupby("stratum").agg(n=("lid", "size"), fri_teacher=("fri", "mean"), fri_student=("fri_oof", "mean"),
                                 syn_teacher=("syndrome", "mean"), syn_student=("syn_oof", "mean"))
print(by.round(3).to_string())

# Final models on all labels; score every post; calibrate with isotonic fits on the OOF predictions.
raw = np.column_stack([predict_marker(fit_marker(li, Y[:, j])) for j in range(len(MARKERS))])
fri_raw = 100 * raw.sum(1) / 14
fri_cal = iso(oof_raw, lab.fri.values).predict(fri_raw)
scale = fri_cal / np.maximum(fri_raw, 1e-6)
scores = pd.DataFrame({"post_id": df.post_id.values})
for j, m in enumerate(MARKERS):
    scores["fri_" + m] = (raw[:, j] * scale).astype(np.float32)  # rescaled so the seven sum to the calibrated index
scores["fri"] = fri_cal.astype(np.float32)
scores["fri_raw"] = fri_raw.astype(np.float32)
p_syn = fit_syn(li, lab.syndrome.values).predict_proba(Xridge)[:, 1]
scores["fri_p_syndrome"] = iso(oof_syn_raw, lab.syndrome.values.astype(float)).predict(p_syn).astype(np.float32)
scores.to_parquet(os.path.join(out, "fri_scores.parquet"), index=False)

o = lab[["lid", "post_id", "stratum"] + MARKERS + ["fri", "syndrome"]].copy()
for j, m in enumerate(MARKERS):
    o[m + "_oof"] = oof[:, j]
o["fri_oof_raw"], o["fri_oof"], o["syndrome_oof"] = oof_raw, oof_fri, oof_syn
o.to_csv(os.path.join(out, "fri_oof_predictions.csv"), index=False)
rep.to_csv(os.path.join(out, "fri_validation.csv"), index=False)
by.reset_index().to_csv(os.path.join(out, "fri_validation_by_stratum.csv"), index=False)
pd.DataFrame(np.corrcoef(Y.T), index=MARKERS, columns=MARKERS).to_csv(os.path.join(out, "fri_teacher_marker_correlations.csv"))
print(scores.describe().round(3).to_string())
