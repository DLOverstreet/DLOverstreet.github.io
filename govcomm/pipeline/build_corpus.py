"""Assemble every reachable official-communication source into one post-level table.

Usage: python3 -I build_corpus.py <sources_root> <out_parquet>
<sources_root> holds the cloned public archives (see SOURCES.md for the list).
"""
import csv
import glob
import json
import os
import re
import sys
from datetime import datetime, timezone

import ftfy
import pandas as pd

ROOT, OUT = sys.argv[1], sys.argv[2]
csv.field_size_limit(10**9)

ADMINS = [  # (start, label, president, party)
    ("1900-01-01", "Bush (43)", "George W. Bush", "R"),
    ("2009-01-20T17:00:00", "Obama", "Barack Obama", "D"),
    ("2017-01-20T17:00:00", "Trump I", "Donald Trump", "R"),
    ("2021-01-20T17:00:00", "Biden", "Joe Biden", "D"),
    ("2025-01-20T17:00:00", "Trump II", "Donald Trump", "R"),
]
ADMIN_TS = [(pd.Timestamp(s, tz="UTC"), lab, pres, party) for s, lab, pres, party in ADMINS]


def admin_of(ts):
    cur = ADMIN_TS[0]
    for a in ADMIN_TS:
        if ts >= a[0]:
            cur = a
    return cur[1], cur[3]


def clean(t):
    if t is None or (isinstance(t, float) and pd.isna(t)):
        return ""
    t = ftfy.fix_text(str(t))
    t = re.sub(r"<br\s*/?>|</p>\s*<p>", "\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'")
    return re.sub(r"[ \t]+", " ", t).strip()


rows = []


def add(**r):
    rows.append(r)


# 1. @realDonaldTrump, complete 2009-05 to 2021-01 (MarkHershey/CompleteTrumpTweetsArchive)
for fn in glob.glob(f"{ROOT}/markhershey/completetrumptweetsarchive/data/*.csv"):
    with open(fn, encoding="utf-8", errors="replace") as f:
        rd = csv.reader(f, skipinitialspace=True)
        next(rd)
        for r in rd:
            if len(r) < 4:
                continue
            ts = pd.Timestamp(r[1], tz="UTC")  # archive times are UTC
            add(post_id="tw:" + r[2].rsplit("/", 1)[-1], platform="Twitter", account="@realDonaldTrump",
                created_at=ts, text=clean(r[3]), url=r[2].strip(), source="MarkHershey/CompleteTrumpTweetsArchive")

# 2. Truth Social @realDonaldTrump, 2022-02 to 2026-05 (stiles/trump-truth-social-archive)
for p in json.load(open(f"{ROOT}/stiles/trump-truth-social-archive/data/truth_archive.json", encoding="utf-8")):
    add(post_id="ts:" + p["id"], platform="Truth Social", account="@realDonaldTrump (Truth Social)",
        created_at=pd.Timestamp(p["created_at"]), text=clean(p.get("content")), url=p.get("url"),
        source="stiles/trump-truth-social-archive", n_media=len(p.get("media") or []),
        engagement=(p.get("favourites_count") or 0))

# 3. Early-2017 institutional and staff accounts (bpb27/political_twitter_archive)
BPB = {"potus": "@POTUS", "whitehouse": "@WhiteHouse", "vp": "@VP", "danscavino": "@DanScavino",
       "seanspicer": "@SeanSpicer", "kellyannepolls": "@KellyannePolls"}
for handle, acct in BPB.items():
    with open(f"{ROOT}/bpb27/political_twitter_archive/{handle}/{handle}.csv", encoding="utf-8", errors="replace") as f:
        for r in csv.DictReader(f):
            try:
                ts = pd.Timestamp(datetime.strptime(r["created_at"], "%a %b %d %H:%M:%S %z %Y"))
            except (ValueError, KeyError):
                continue
            add(post_id="tw:" + r["id_str"], platform="Twitter", account=acct, created_at=ts,
                text=clean(r["text"]), url=f"https://twitter.com/{handle}/status/{r['id_str']}",
                source="bpb27/political_twitter_archive", engagement=int(r.get("favorite_count") or 0))

# 4. @StateDept 2008-01 to 2025-01 (lockdown-systems/statedept-archive)
for fn in sorted(glob.glob(f"{ROOT}/lockdown-systems/statedept-archive/docs/data/[12]*.json")):
    for t in json.load(open(fn, encoding="utf-8")).get("tweets", []):
        add(post_id="tw:" + t["id"], platform="Twitter", account="@StateDept", created_at=pd.Timestamp(t["created_at"]),
            text=clean(t["text"]), url=f"https://x.com/StateDept/status/{t['id']}",
            source="lockdown-systems/statedept-archive", n_media=t.get("media_count", 0))

# 5. WhiteHouse.gov posts 2025-01 to present (Transparency47/WhiteHouse)
WH = f"{ROOT}/transparency47/whitehouse"
for fn in glob.glob(f"{WH}/**/*.md", recursive=True):
    base = os.path.basename(fn)
    if base in ("metadata.md", "README.md") or "/Scrapers/" in fn:
        continue
    raw = open(fn, encoding="utf-8", errors="replace").read()
    m = re.search(r"date_published:\s*(\S+)", raw)
    src = re.search(r"source:\s*(\S+)", raw)
    if not m:
        continue
    body = re.sub(r"<!--.*?-->", "", raw, flags=re.S).strip()
    title = re.search(r"^#\s+(.+)$", body, flags=re.M)
    title = title.group(1).strip() if title else base[:-3].replace("_", " ")
    body = re.sub(r"^#\s+.+$", "", body, count=1, flags=re.M).strip()
    rel = os.path.relpath(fn, WH).split(os.sep)
    cat = rel[0] if rel[0] != "Actions" else "Actions/" + rel[1]
    add(post_id="wh:" + (src.group(1) if src else rel[-1]), platform="WhiteHouse.gov", account="WhiteHouse.gov",
        created_at=pd.Timestamp(m.group(1)), title=clean(title), text=clean(body), url=src.group(1) if src else None,
        source="Transparency47/WhiteHouse", wh_category=cat)

# 6. Federal X accounts, 2016-2026 (vidproject/x: browser captures of public timelines)
VP = f"{ROOT}/vidproject/x/data"
for fn in sorted(glob.glob(f"{VP}/*.parquet")):
    handle = os.path.basename(fn)[:-8]
    if handle.startswith(("catalog", "_misc")):
        continue
    x = pd.read_parquet(fn, columns=["tweet_id", "posted_at", "tweet_type", "text", "tweet_url", "like_count", "media"])
    for r in x.itertuples(index=False):
        t = clean(r.text)
        if r.tweet_type == "retweet" and not t.startswith("RT"):
            t = "RT " + t
        add(post_id="tw:" + str(r.tweet_id), platform="Twitter", account="@" + handle, created_at=pd.Timestamp(r.posted_at),
            text=t, url=r.tweet_url, source="vidproject/x", engagement=r.like_count,
            n_media=len(r.media) if r.media is not None else 0, priority=1)

# 7. Truth Social and X posts mirrored by Transparency47/socials (2025-2026)
SO = f"{ROOT}/transparency47/socials"
for fn in glob.glob(f"{SO}/TruthSocial/RealDonaldTrump/**/POST.md", recursive=True) + glob.glob(f"{SO}/X/**/POST.md", recursive=True):
    raw = open(fn, encoding="utf-8", errors="replace").read()
    meta = dict(re.findall(r"<!--\s*(\w+):\s*(.*?)\s*-->", raw))
    if "post_id" not in meta or "date_published" not in meta:
        continue
    body = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    body = re.sub(r"^#\s.*$", "", body, count=1, flags=re.M)
    body = body.split("\n## Media")[0]
    body = re.sub(r"\[@\s*([^\]]+)\]\([^)]*\)", r"@\1", body)
    body = re.sub(r"\[([^\]]*)\]\(([^)]*)\)", r"\1 \2", body).strip()
    body = re.sub(r"^Repost of (@\w+):", r"RT \1:", body)
    body = body.replace("_No text content captured._", "")  # image- or video-only post
    # Truth Social links arrive split at Mastodon's hidden spans ("https://www. site.com/pa th"); drop them whole.
    body = re.sub(r"https?://(?:www\.)?\s\S+(?:\s(?=\S*[/\-.?=_%0-9])\S+)?", " ", body)
    ts = meta.get("platform") == "TruthSocial"
    add(post_id=("ts:" if ts else "tw:") + meta["post_id"], platform="Truth Social" if ts else "Twitter",
        account="@realDonaldTrump (Truth Social)" if ts else ("@realDonaldTrump" if meta.get("account", "").lower() == "realdonaldtrump" else "@" + meta.get("account", "")),
        created_at=pd.Timestamp(meta["date_published"]), text=clean(body), url=meta.get("source"),
        source="Transparency47/socials", priority=2)

df = pd.DataFrame(rows)
df["created_at"] = pd.to_datetime(df["created_at"], utc=True)
df["priority"] = df["priority"].fillna(0)
df = df.sort_values("priority").drop_duplicates("post_id").drop(columns="priority")
df = df.sort_values("created_at").reset_index(drop=True)
adm = df["created_at"].map(admin_of)
df["administration"] = [a for a, _ in adm]
df["admin_party"] = [p for _, p in adm]
df["is_repost"] = df["text"].str.match(r"^(RT @|RT:|RT\s)", na=False)
df["is_reply"] = df["text"].str.match(r"^@\w+", na=False) & (df["platform"] == "Twitter")
df["n_words"] = df["text"].str.split().str.len().fillna(0).astype(int)

# Who speaks, in what capacity. Trump's own accounts count as presidential only while he held office.
def role(r):
    a = r["account"]
    if a.startswith("@realDonaldTrump"):
        return "President (personal voice)" if r["administration"].startswith("Trump") else "Trump out of office"
    if a in ("@POTUS", "@WhiteHouse", "WhiteHouse.gov"):
        return "White House (institutional)"
    if a == "@VP":
        return "Vice President"
    if a == "@StateDept":
        return "Agency"
    return "White House staff (personal)"
df["role"] = df.apply(role, axis=1)

WH_INST = {"@WhiteHouse", "@WhiteHouse45", "@WhiteHouse46", "@ObamaWhiteHouse", "@POTUS", "WhiteHouse.gov", "@PressSec", "@RapidResponse47"}
OFFICIALS = {"@SecRubio", "@SecWar", "@PeteHegseth", "@FBIDirectorKash", "@AGPamBondi", "@SecMullinDHS", "@Sonderling47", "@USCISJoe",
             "@CBPCommissioner", "@USBPChief", "@OFOEAC", "@GregoryKBovino", "@RealTomHoman", "@StephenM", "@EnvoyNoem", "@VP"}
DEPT = {"White House": WH_INST | {"@StephenM", "@RealTomHoman", "@VP"},
        "Justice": {"@TheJusticeDept", "@FBI", "@ATFHQ", "@FBIDirectorKash", "@AGPamBondi"},
        "Defense/War": {"@DeptofWar", "@DOWResponse", "@SecWar", "@PeteHegseth"},
        "State": {"@StateDept", "@SecRubio"}, "Labor": {"@USDOL", "@Sonderling47"}}
def dept(a):
    if a.startswith("@realDonaldTrump"):
        return "President (personal)"
    for k, v in DEPT.items():
        if a in v:
            return k
    if a in ("@SeanSpicer", "@KellyannePolls", "@DanScavino"):
        return "White House"
    return "Homeland Security"
def acct_type(a):
    if a.startswith("@realDonaldTrump"):
        return "President's personal account"
    if a in WH_INST:
        return "White House (institutional)"
    if a in OFFICIALS or a in ("@SeanSpicer", "@KellyannePolls", "@DanScavino"):
        return "Official's account"
    if a.startswith(("@ERO", "@Ero")) or a == "@USBPChiefELC":
        return "Agency field office"
    return "Agency headquarters"
df["department"] = df["account"].map(dept)
df["account_type"] = df["account"].map(acct_type)
# Every account other than Trump's own and the 2017 staff accounts takes its account type as its role.
other = ~df["account"].str.startswith("@realDonaldTrump") & ~df["account"].isin(["@SeanSpicer", "@KellyannePolls", "@DanScavino"])
df.loc[other, "role"] = df.loc[other, "account_type"]
staff_terms = {"@SeanSpicer": ("2017-01-20", "2017-07-21"), "@KellyannePolls": ("2017-01-20", "2020-08-31"),
               "@DanScavino": ("2017-01-20", "2021-01-20")}
for a, (s, e) in staff_terms.items():
    out = (df["account"] == a) & ((df["created_at"] < pd.Timestamp(s, tz="UTC")) | (df["created_at"] > pd.Timestamp(e, tz="UTC")))
    df.loc[out, "role"] = "Staff out of office"
df.to_parquet(OUT, index=False)
print(df.groupby(["account", "role"]).agg(n=("post_id", "size"), first=("created_at", "min"), last=("created_at", "max")).to_string())
print("total", len(df))
