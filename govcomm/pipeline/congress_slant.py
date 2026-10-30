"""External ideology benchmark: party-language slant learned from members of Congress.

Trains a TF-IDF logistic regression on tweets by members of Congress (2017-2023, a biweekly
sample of alexlitel/congresstweets), labeled R=1 / D=0 from unitedstates/congress-legislators.
Folds are grouped by member so the model cannot score well by memorising individual accounts.
The fitted model then scores every post in the corpus: slant = 2*P(Republican) - 1.

Usage: python3 -I congress_slant.py <congresstweets/data> <congress-legislators dir> <corpus.parquet> <out_dir>
"""
import glob
import json
import os
import re
import sys

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

ct_dir, leg_dir, corpus_path, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)

# Party of every legislator, keyed by bioguide id (last party held).
party = {}
for fn in ("legislators-historical.yaml", "legislators-current.yaml"):
    for m in yaml.safe_load(open(os.path.join(leg_dir, fn))):
        terms = [t for t in m["terms"] if t.get("end", "") >= "2017-01-01"]
        if terms:
            party[m["id"]["bioguide"]] = terms[-1].get("party")
handle2bio, id2bio = {}, {}
for m in yaml.safe_load(open(os.path.join(leg_dir, "legislators-social-media.yaml"))):
    sm, bio = m.get("social", {}), m["id"]["bioguide"]
    if sm.get("twitter"):
        handle2bio[sm["twitter"].lower()] = bio
    if sm.get("twitter_id"):
        id2bio[str(sm["twitter_id"])] = bio


STATES = ("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho "
          "illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota "
          "mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma "
          "oregon pennsylvania rhode tennessee texas utah vermont virginia washington wisconsin wyoming").split()
# Person names and places are dropped: otherwise the model learns "mentions the other side's
# president" and state composition instead of ideological language.
NAMES = ("trump donald biden joe obama barack pelosi nancy schumer chuck mcconnell mitch schiff hawley harris "
         "kamala pence mike clinton hillary sanders bernie warren aoc ocasio cortez mccarthy kevin jordan cruz "
         "graham desantis newsom cuomo potus flotus vp realdonaldtrump joebiden djt").split()
_drop = re.compile(r"\b(" + "|".join(NAMES + STATES) + r")\w*\b|\b[a-z]{2}\d{1,2}\b|\b[a-z]{2}pol\b|\b[a-z]{2}sen\b|\b[a-z]{2}gov\b")


def norm(t):
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"@\w+", " @user ", t).lower()
    t = _drop.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


rows = []
for fn in sorted(glob.glob(os.path.join(ct_dir, "*.json"))):
    for tw in json.load(open(fn, encoding="utf-8")):
        if tw["text"].startswith("RT @"):
            continue
        bio = id2bio.get(str(tw.get("user_id"))) or handle2bio.get(tw["screen_name"].lower())
        p = party.get(bio)
        if p not in ("Republican", "Democrat"):
            continue
        t = norm(tw["text"])
        if len(t.split()) < 5:
            continue
        rows.append((bio, int(p == "Republican"), t, tw["time"][:10]))
ct = pd.DataFrame(rows, columns=["member", "rep", "text", "date"]).drop_duplicates("text")
print(f"congress tweets {len(ct):,} from {ct.member.nunique()} members; share R = {ct.rep.mean():.3f}")

vec = TfidfVectorizer(ngram_range=(1, 2), min_df=20, max_df=0.4, sublinear_tf=True, max_features=200_000)
X = vec.fit_transform(ct.text)
y = ct.rep.values
oof = np.zeros(len(y))
for tr, te in GroupKFold(n_splits=5).split(X, y, ct.member):
    clf = LogisticRegression(C=2.0, max_iter=2000, class_weight="balanced")
    clf.fit(X[tr], y[tr])
    oof[te] = clf.predict_proba(X[te])[:, 1]
auc = roc_auc_score(y, oof)
ct["oof"] = oof
mem = ct.groupby("member").agg(rep=("rep", "first"), slant=("oof", "mean"), n=("oof", "size"))
mem_auc = roc_auc_score(mem.rep, mem.slant)
print(f"tweet-level held-out-member AUC = {auc:.3f}; member-level AUC = {mem_auc:.3f}")

clf = LogisticRegression(C=2.0, max_iter=2000, class_weight="balanced").fit(X, y)
coef = pd.Series(clf.coef_[0], index=vec.get_feature_names_out()).sort_values()
joblib.dump({"vec": vec, "clf": clf}, os.path.join(out, "congress_slant_model.joblib"), compress=3)

corpus = pd.read_parquet(corpus_path)
txt = corpus.apply(lambda r: (r["title"] + ". " if isinstance(r.get("title"), str) else "") + (r["text"] or ""), axis=1)
txt = txt.map(lambda t: norm(" ".join(t.split()[:120])))
corpus_slant = 2 * clf.predict_proba(vec.transform(txt))[:, 1] - 1
pd.DataFrame({"post_id": corpus.post_id, "party_slant": corpus_slant}).to_parquet(os.path.join(out, "party_slant.parquet"), index=False)

with open(os.path.join(out, "congress_slant_report.md"), "w") as f:
    f.write("# Party-language slant benchmark\n\n")
    f.write(f"- Training tweets: {len(ct):,} original tweets from {ct.member.nunique()} members of Congress "
            f"({ct.date.min()} to {ct.date.max()}, every 14th day of alexlitel/congresstweets).\n")
    f.write(f"- Held-out-member AUC (tweet level): **{auc:.3f}**; member-average AUC: **{mem_auc:.3f}**.\n\n")
    f.write("Most Democratic-leaning n-grams: " + ", ".join(coef.index[:40]) + "\n\n")
    f.write("Most Republican-leaning n-grams: " + ", ".join(coef.index[-40:][::-1]) + "\n")
print("top D:", ", ".join(coef.index[:25]))
print("top R:", ", ".join(coef.index[-25:][::-1]))
