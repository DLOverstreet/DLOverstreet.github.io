"""Join corpus, student scores and party slant into the release dataset.

Usage: python3 -I assemble.py <data_dir>
"""
import re
import sys

import pandas as pd

d = sys.argv[1]
df = pd.read_parquet(f"{d}/corpus.parquet")
sc = pd.read_parquet(f"{d}/derived/student_scores.parquet")
sl = pd.read_parquet(f"{d}/derived/party_slant.parquet")
df = df.merge(sc, on="post_id").merge(sl, on="post_id")

bare = df["text"].fillna("").str.replace(r"https?://\S+", "", regex=True).str.strip()
df["analysis_sample"] = (~df["is_repost"]) & ((bare.str.split().str.len() >= 4) | (df.platform == "WhiteHouse.gov"))


WH_ACCOUNTS = {"@ObamaWhiteHouse", "@WhiteHouse45", "@WhiteHouse46", "@WhiteHouse"}
T2 = pd.Timestamp("2025-01-20 17:00", tz="UTC")


def voice(r):
    a = r["account"]
    if a == "@realDonaldTrump":
        if not r["role"].startswith("President"):
            return "Trump · Twitter (private citizen/candidate)"
        return "Trump · X (President, 2025–)" if r["created_at"] >= T2 else "Trump · Twitter (President)"
    if a.startswith("@realDonaldTrump (Truth"):
        return "Trump · Truth Social (President)" if r["role"].startswith("President") else "Trump · Truth Social (out of office)"
    if a in WH_ACCOUNTS:
        return "@WhiteHouse (all administrations)"
    if r["role"] == "White House staff (personal)":
        return "Staff accounts"
    if r["role"] == "Staff out of office":
        return "Staff (before office)"
    if a.startswith(("@ERO", "@Ero")):
        return "ICE field offices (ERO, pooled)"
    return a


df["voice"] = df.apply(voice, axis=1)
SECS = [("2009-01-21", "Clinton"), ("2013-02-01", "Kerry"), ("2017-02-01", "Tillerson"), ("2018-04-26", "Pompeo"),
        ("2021-01-26", "Blinken"), ("2025-01-21", "Rubio")]
def sec(ts):
    cur = "Rice"
    for s, n in SECS:
        if ts >= pd.Timestamp(s, tz="UTC"):
            cur = n
    return cur
df["secretary_of_state"] = df["created_at"].map(sec)
df.loc[df.account != "@StateDept", "secretary_of_state"] = None
df.to_parquet(f"{d}/scored_posts.parquet", index=False)
cols = ["post_id", "created_at", "platform", "account", "voice", "role", "administration", "admin_party", "is_repost",
        "is_reply", "analysis_sample", "ideology", "professionalism", "partisanship", "threat_hope", "personalization",
        "function", "party_slant", "villain", "topic", "wh_category", "secretary_of_state", "engagement", "n_words",
        "url", "title", "text", "source"]
df[cols].to_csv(f"{d}/scored_posts.csv.gz", index=False, compression="gzip")
print(df.groupby("voice").agg(n=("post_id", "size"), analysis=("analysis_sample", "sum")).to_string())
