"""Train student models on the teacher (Claude) labels, validate them, and score the full corpus.

Usage: python3 -I student.py <corpus.parquet> <labels_dir> <glove.gz> <out_dir>
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy import sparse
from scipy.stats import pearsonr, spearmanr
from sklearn.decomposition import TruncatedSVD
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import KFold
from sklearn.preprocessing import StandardScaler
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import STYLE_NAMES, clean_for_model, glove_mean, load_glove, style_features, unit_text  # noqa: E402

corpus_path, labels_dir, glove_path, out = sys.argv[1:5]
DIMS = ["ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function"]
CATS = ["villain", "topic"]
rng = 20261030

df = pd.read_parquet(corpus_path)
df["unit"] = [unit_text(p, t, x) for p, t, x in zip(df.platform, df.title, df.text)]
df["mtext"] = df["unit"].map(clean_for_model)

key = pd.read_csv(os.path.join(labels_dir, "label_sample_key.csv"))
lab = pd.read_csv(os.path.join(labels_dir, "teacher_labels.csv")).merge(key[["lid", "post_id"]], on="lid")
idx = pd.Series(np.arange(len(df)), index=df.post_id)
li = idx.loc[lab.post_id].values
print(f"labels: {len(lab)}  corpus: {len(df):,}")

# Dense features: style, VADER, GloVe-Twitter means.
sia = SentimentIntensityAnalyzer()
style = np.array([style_features(t) for t in df["unit"]], dtype=np.float32)
vad = np.array([[v["neg"], v["neu"], v["pos"], v["compound"]] for v in map(sia.polarity_scores, df["mtext"])], dtype=np.float32)
vocab = set(w for t in df["mtext"].str.lower() for w in t.split())
gl = load_glove(glove_path, vocab)
glv = np.vstack([glove_mean(t, gl) for t in df["mtext"]])
print(f"glove coverage: {len(gl):,} words")
dense = np.hstack([style, vad, glv])
dense_names = STYLE_NAMES + ["vader_neg", "vader_neu", "vader_pos", "vader_compound"] + [f"glove{i}" for i in range(glv.shape[1])]

# Sparse features fit on the whole corpus (unsupervised vocabulary).
wv = TfidfVectorizer(ngram_range=(1, 2), min_df=3, max_df=0.5, sublinear_tf=True, max_features=150_000, lowercase=True)
cv = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), min_df=5, sublinear_tf=True, max_features=150_000, lowercase=False)
Xw = wv.fit_transform(df["mtext"])
Xc = cv.fit_transform(df["mtext"])
svd = TruncatedSVD(n_components=100, random_state=rng).fit(Xw[li])
Zsvd = svd.transform(Xw)
scaler = StandardScaler().fit(dense)
D = scaler.transform(dense)
Xridge = sparse.hstack([Xw, Xc, sparse.csr_matrix(D * 0.35)]).tocsr()
Xgb = np.hstack([dense, Zsvd])

Y = lab[DIMS].values
kf = KFold(n_splits=5, shuffle=True, random_state=rng)
oof = {m: np.zeros_like(Y) for m in ("ridge", "gbm", "ens")}
for tr, te in kf.split(li):
    for j, d in enumerate(DIMS):
        r = Ridge(alpha=2.5).fit(Xridge[li[tr]], Y[tr, j])
        g = HistGradientBoostingRegressor(max_iter=350, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0,
                                          random_state=rng).fit(Xgb[li[tr]], Y[tr, j])
        oof["ridge"][te, j] = r.predict(Xridge[li[te]])
        oof["gbm"][te, j] = g.predict(Xgb[li[te]])
oof["ens"] = (oof["ridge"] + oof["gbm"]) / 2

rep = []
for j, d in enumerate(DIMS):
    row = {"dimension": d, "teacher_sd": Y[:, j].std()}
    for m in oof:
        row[f"r_{m}"] = pearsonr(Y[:, j], oof[m][:, j])[0]
    row["rho_ens"] = spearmanr(Y[:, j], oof["ens"][:, j])[0]
    row["mae_ens"] = np.abs(Y[:, j] - np.clip(oof["ens"][:, j], -1, 1)).mean()
    rep.append(row)
rep = pd.DataFrame(rep)
print(rep.round(3).to_string(index=False))

# Final regressors on all labels; score every post.
scores = pd.DataFrame({"post_id": df.post_id})
for j, d in enumerate(DIMS):
    r = Ridge(alpha=2.5).fit(Xridge[li], Y[:, j])
    g = HistGradientBoostingRegressor(max_iter=350, learning_rate=0.05, max_leaf_nodes=15, l2_regularization=1.0,
                                      random_state=rng).fit(Xgb[li], Y[:, j])
    scores[d] = np.clip((r.predict(Xridge) + g.predict(Xgb)) / 2, -1, 1)

# Categorical codes: logistic regression on the same sparse + dense design.
cat_rep = []
for c in CATS:
    yc = lab[c].values
    pred = np.empty(len(yc), dtype=object)
    for tr, te in kf.split(li):
        m = LogisticRegression(C=4.0, max_iter=3000, class_weight="balanced").fit(Xridge[li[tr]], yc[tr])
        pred[te] = m.predict(Xridge[li[te]])
    cat_rep.append({"code": c, "accuracy": accuracy_score(yc, pred), "macro_f1": f1_score(yc, pred, average="macro"),
                    "majority_baseline": pd.Series(yc).value_counts(normalize=True).iloc[0]})
    m = LogisticRegression(C=4.0, max_iter=3000, class_weight="balanced").fit(Xridge[li], yc)
    proba = m.predict_proba(Xridge)
    scores[c] = m.classes_[proba.argmax(1)]
    scores[c + "_conf"] = proba.max(1)
    pd.crosstab(pd.Series(yc, name="teacher"), pd.Series(pred, name="student")).to_csv(os.path.join(out, f"confusion_{c}.csv"))
cat_rep = pd.DataFrame(cat_rep)
print(cat_rep.round(3).to_string(index=False))

os.makedirs(out, exist_ok=True)
scores.to_parquet(os.path.join(out, "student_scores.parquet"), index=False)
o = lab[["lid", "post_id"]].copy()
for j, d in enumerate(DIMS):
    o[d + "_teacher"] = Y[:, j]
    o[d + "_oof"] = oof["ens"][:, j]
o.to_csv(os.path.join(out, "oof_predictions.csv"), index=False)
rep.to_csv(os.path.join(out, "validation_dimensions.csv"), index=False)
cat_rep.to_csv(os.path.join(out, "validation_categories.csv"), index=False)
pd.DataFrame(np.corrcoef(Y.T), index=DIMS, columns=DIMS).to_csv(os.path.join(out, "teacher_dimension_correlations.csv"))
print("teacher-label correlations between dimensions:\n", pd.DataFrame(np.corrcoef(Y.T), index=DIMS, columns=DIMS).round(2))
