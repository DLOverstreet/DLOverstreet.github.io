"""Assign passages to topics with fixed dictionaries that span both sides of each break (old and new vocabulary).

Treated topics
  RACE       race, lineage and priesthood/temple eligibility (break: June 1978, Official Declaration 2)
  MINISTER   home teaching, visiting teaching and ministering (break: April 2018, ministering replaces both)
Spillover topics (plausibly touched by a treatment; excluded from the clean control pool)
  MISSION    missionary work, conversion and international growth
  TEMPLE     temples, ordinances, family history
  LAMANITE   Lamanites, American Indians, Polynesians (race-adjacent lineage discourse)
Control topics
  TITHING, WOW (Word of Wisdom), SABBATH, PRAYER (prayer and scripture study), WELFARE (welfare, self-reliance,
  the poor), CHASTITY

A passage belongs to a topic when its dictionary hits reach the topic's threshold; its primary topic is the one with
the largest hits/threshold ratio (treated topics win ties). Africa/Brazil terms count toward RACE only with a race,
color or priesthood term in the same passage; 'prejudice'/'discrimination' only with a race, color or nationality term;
'slave/slavery' only with a race or African term or a reference to the South.

Usage: python3 -I topics.py <chunks.parquet> <talk_ranks.csv> <out.parquet>
"""
import sys

import numpy as np
import pandas as pd

src, ranks_path, out = sys.argv[1:4]
ch = pd.read_parquet(src)
ch = ch[~ch.procedural].reset_index(drop=True)
low = ch.text.str.lower().str.replace("’", "'").str.replace(r"(\w) - (\w)", r"\1\2", regex=True)

RACE_STRONG = (r"\bnegro(e?s)?\b|\bblacks\b|\bblack (people|members|saints|men|man|women|brethren|brothers|sisters|race|africans?|americans?|"
               r"families|converts|person|persons|community|children|skin)\b|\bracial|\bracism|\bracist|\bevery race\b|\ball races\b|\bother races\b|"
               r"\bany race\b|\brace or colou?r|\bregardless of (race|colou?r)|without regard (for|to) race|\bskin colou?r|\bcolou?r of (their|his|her|our|the) skin|"
               r"\bseed of cain\b|\bcurse of cain\b|\bmark of cain\b|\bdescendants of cain\b|\blineage of (cain|ham)\b|\bcanaanites?\b|"
               r"every (faithful, )?worthy (man|male)|all worthy male|long-promised day|official declaration|1978 revelation|"
               r"revelation (on|concerning|regarding|on the) (the )?priesthood|black and white, bond and free|all are alike unto god|\bsegregat|"
               r"\bcivil rights\b|\bethnic|white and delightsome|pure and delightsome")
SLAVE = r"\bslave(s|ry|holders?|holding)?\b|\babolition"
RACE_CTX = r"\brace\b|\braces\b|\bcolou?r\b|\bnationalit|\bblack\b|\bpriesthood\b"
AFRICA = r"\bafrica|\bnigeria|\bghana|\bkenya|\bzimbabwe|\bcongo|\bbrazil|\bsouth africa|\bsierra leone|\bivory coast|\bcote d'ivoire"
PREJ = r"\bprejudic|\bdiscriminat|\bbigot"
HAM = r"\bham\b"
TOPICS = {
    "MINISTER": (r"home teach|visiting teach|\bministering\b|\bblock teach|\bward teach|\bwatchcare|\bwatch care|\bminister(ing)? to (one another|each other|the one|them|their|families|individuals)", 1),
    "MISSION": (r"\bmissionar(y|ies)\b|\bmission field|\bproselyt|\bconverts?\b|\bpreach(ing)? the gospel|\bfull-time mission|\bconversion\b", 3),
    "TEMPLE": (r"\btemples?\b|\bendowment|\bsealings?\b|\bsealed\b|ordinances for the dead|\bfamily history|\bgenealog|\bbaptisms? for the dead", 3),
    "LAMANITE": (r"\blamanites?\b|\bindians?\b|native americans?|\bpolynesians?|indian placement|\bnavajo|\bhopi\b|\bmaori", 2),
    "TITHING": (r"\btithing|\btithes?\b|\bfast offerings?\b|\btithepayer|\bone-tenth|\bwindows of heaven", 2),
    "WOW": (r"word of wisdom|\btobacco|\balcohol|\bliquor|\bcoffee\b|\btea\b|\bdrugs?\b|\bsmok(e|ing)\b|\bdrunk|\bwhisky|\bwhiskey|\bnarcotic", 2),
    "SABBATH": (r"\bsabbath|\bsacrament meeting|\bday of rest|\blord's day|\bsunday (shopping|work|recreation)", 2),
    "PRAYER": (r"\bpray(er|ers|ing|ed|s)?\b|\bscripture study|\bstudy (the|his|our) scriptures|\bsearch the scriptures|\bread(ing)? the scriptures|\bkneel", 4),
    "WELFARE": (r"\bwelfare|self-relian|self relian|\bfood storage|\bthe poor\b|\bthe needy\b|\bstorehouse|\bhumanitarian|\brefugees?\b|\bunemploy|\bindebted|\bdebt\b", 3),
    "CHASTITY": (r"\bchastity|\bchaste\b|\bimmoral|\bpornograph|\badultery|\bfornication|\bsexual (sin|purity|relations|transgression)|\bmorally clean", 2),
}
hits = pd.DataFrame(index=ch.index)
race_strong = low.str.count(RACE_STRONG)
race_ctx = low.str.contains(RACE_CTX)
africa = low.str.count(AFRICA) * race_ctx
prej = low.str.count(PREJ) * low.str.contains(r"\brace\b|\braces\b|\bcolou?r\b|\bnationalit|\bethnic")
ham = low.str.count(HAM) * low.str.contains(r"\bcurse|\bnoah\b|\bcanaan|\bseed\b|\blineage")
slave = low.str.count(SLAVE) * low.str.contains(r"\bnegro|\bafrican|\bblack\b|\brace\b|\bcolou?r\b|\bsouth(ern)? states|\bthe south\b|\bnorth and south")
hits["RACE"] = race_strong + africa + prej + ham + slave
thr = {"RACE": 1}
for k, (p, th) in TOPICS.items():
    hits[k] = low.str.count(p)
    thr[k] = th
ratio = hits / pd.Series(thr)
member = ratio >= 1
ch["topics"] = member.apply(lambda r: ",".join(r.index[r]), axis=1)
prio = ["RACE", "MINISTER"]
prim = ratio.where(member)
for k in prio:  # treated topics win ties
    prim[k] = prim[k] + 1e-6
ch["primary"] = prim.fillna(-1).idxmax(axis=1).where(member.any(axis=1), "NONE")
for k in hits:
    ch["hits_" + k] = hits[k].astype(np.int16)
ch["race_strong"] = race_strong.astype(np.int16)
r = pd.read_csv(ranks_path).set_index("talk_id")
ch["rank"] = ch.talk_id.map(r["rank"])
ch["woman"] = ch.talk_id.map(r["woman"]).fillna(False)
ch["speaker_n"] = ch.talk_id.map(r["speaker_n"])
ch.drop(columns=["text"]).to_parquet(out, index=False)
pd.set_option("display.width", 250)
b = pd.cut(ch.year, [1830, 1886, 1897, 1970, 1977, 1978, 1985, 1995, 2005, 2013, 2017, 2020, 2023, 2026])
print(pd.crosstab(b, ch.primary).to_string())
print("members (any):", member.sum().to_dict())
