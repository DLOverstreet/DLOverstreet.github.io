"""Speaker rank at the date of each talk: First Presidency (FP), Quorum of the Twelve (Q12), Seventy and other
male general authorities (GA: Seventies, Assistants to the Twelve, Presiding Bishopric, Patriarch), and auxiliary
and general officers (AUX: Relief Society, Young Women, Primary, Sunday School and Young Men presidencies and
other officers).

Sources, in order of precedence:
  1. A hand-built table of First Presidency service and apostleship dates (below), 1847-2026.
  2. The calling printed with each 1971-2018 talk (johnmwood/LDS-Conference-Scraper), matched by URL slug and
     carried to the same speaker's other talks by nearest date.
  3. A list of women and men who served in auxiliary presidencies after 2018 (not in source 2).
  4. Otherwise: GA for General Conference speakers, OTHER for nineteenth-century speakers.

Usage: python3 -I ranks.py <talks.parquet> <johnmwood conference_talks.csv> <out.csv>
"""
import difflib
import re
import sys
import unicodedata

import pandas as pd

talks_path, jw_path, out = sys.argv[1:4]
INF = "2100-01-01"

# name, apostleship start, apostleship end (death, release or excommunication), First Presidency periods
APOSTLES = [
    # nineteenth century
    ("Brigham Young", "1835-02-14", "1877-08-29", [("1847-12-27", "1877-08-29")]),
    ("Heber C. Kimball", "1835-02-14", "1868-06-22", [("1847-12-27", "1868-06-22")]),
    ("Willard Richards", "1840-04-14", "1854-03-11", [("1847-12-27", "1854-03-11")]),
    ("Jedediah M. Grant", "1854-04-07", "1856-12-01", [("1854-04-07", "1856-12-01")]),
    ("Daniel H. Wells", "1857-01-04", "1877-08-29", [("1857-01-04", "1877-08-29")]),
    ("George A. Smith", "1839-04-26", "1875-09-01", [("1868-10-07", "1875-09-01")]),
    ("John Taylor", "1838-12-19", "1887-07-25", [("1880-10-10", "1887-07-25")]),
    ("George Q. Cannon", "1860-08-26", "1901-04-12", [("1880-10-10", "1887-07-25"), ("1889-04-07", "1901-04-12")]),
    ("Joseph F. Smith", "1866-07-01", "1918-11-19", [("1880-10-10", "1887-07-25"), ("1889-04-07", "1918-11-19")]),
    ("Wilford Woodruff", "1839-04-26", "1898-09-02", [("1889-04-07", "1898-09-02")]),
    ("Lorenzo Snow", "1849-02-12", "1901-10-10", [("1898-09-13", "1901-10-10")]),
    ("Orson Hyde", "1835-02-15", "1878-11-28", []),
    ("Orson Pratt", "1835-04-26", "1881-10-03", []),
    ("Parley P. Pratt", "1835-02-21", "1857-05-13", []),
    ("Erastus Snow", "1849-02-12", "1888-05-27", []),
    ("Franklin D. Richards", "1849-02-12", "1899-12-09", []),
    ("Ezra T. Benson", "1846-07-16", "1869-09-03", []),
    ("Charles C. Rich", "1849-02-12", "1883-11-17", []),
    ("Amasa M. Lyman", "1842-08-20", "1867-10-06", []),
    ("Brigham Young Jr.", "1868-10-09", "1903-04-11", []),
    ("Albert Carrington", "1870-07-03", "1885-11-07", []),
    ("Moses Thatcher", "1879-04-09", "1896-04-06", []),
    ("Francis M. Lyman", "1880-10-27", "1916-11-18", []),
    ("John Henry Smith", "1880-10-27", "1911-10-13", []),
    ("George Teasdale", "1882-10-16", "1907-06-09", []),
    ("Heber J. Grant", "1882-10-16", "1945-05-14", []),
    ("John W. Taylor", "1884-04-09", "1905-10-28", []),
    ("Marriner W. Merrill", "1889-10-07", "1906-02-06", []),
    ("Anthon H. Lund", "1889-10-07", "1921-03-02", []),
    ("Abraham H. Cannon", "1889-10-07", "1896-07-19", []),
    ("Matthias F. Cowley", "1897-10-07", "1905-10-28", []),
    ("Abraham O. Woodruff", "1897-10-07", "1904-06-20", []),
    # twentieth and twenty-first centuries
    ("Joseph Fielding Smith", "1910-04-07", "1972-07-02", [("1965-10-29", "1972-07-02")]),
    ("Harold B. Lee", "1941-04-10", "1973-12-26", [("1970-01-23", "1973-12-26")]),
    ("N. Eldon Tanner", "1962-10-11", "1982-11-27", [("1963-10-04", "1982-11-27")]),
    ("Hugh B. Brown", "1958-04-10", "1975-12-02", [("1961-06-22", "1970-01-18")]),
    ("Alvin R. Dyer", "1967-10-05", "1970-01-18", [("1968-04-06", "1970-01-18")]),
    ("Spencer W. Kimball", "1943-10-07", "1985-11-05", [("1973-12-30", "1985-11-05")]),
    ("Marion G. Romney", "1951-10-11", "1988-05-20", [("1972-07-07", "1985-11-05")]),
    ("Ezra Taft Benson", "1943-10-07", "1994-05-30", [("1985-11-10", "1994-05-30")]),
    ("Gordon B. Hinckley", "1961-10-05", "2008-01-27", [("1981-07-15", "2008-01-27")]),
    ("Thomas S. Monson", "1963-10-10", "2018-01-02", [("1985-11-10", "2018-01-02")]),
    ("Howard W. Hunter", "1959-10-15", "1995-03-03", [("1994-06-05", "1995-03-03")]),
    ("Delbert L. Stapley", "1950-10-05", "1978-08-19", []),
    ("Mark E. Petersen", "1944-04-20", "1984-01-11", []),
    ("LeGrand Richards", "1952-04-10", "1983-01-11", []),
    ("Richard L. Evans", "1953-10-08", "1971-11-01", []),
    ("Boyd K. Packer", "1970-04-09", "2015-07-03", []),
    ("Marvin J. Ashton", "1971-12-02", "1994-02-25", []),
    ("Bruce R. McConkie", "1972-10-12", "1985-04-19", []),
    ("L. Tom Perry", "1974-04-11", "2015-05-30", []),
    ("David B. Haight", "1976-01-08", "2004-07-31", []),
    ("James E. Faust", "1978-10-01", "2007-08-10", [("1995-03-12", "2007-08-10")]),
    ("Neal A. Maxwell", "1981-07-23", "2004-07-21", []),
    ("Russell M. Nelson", "1984-04-12", "2025-09-27", [("2018-01-14", "2025-09-27")]),
    ("Dallin H. Oaks", "1984-05-03", INF, [("2018-01-14", INF)]),
    ("M. Russell Ballard", "1985-10-10", "2023-11-12", []),
    ("Joseph B. Wirthlin", "1986-10-09", "2008-12-01", []),
    ("Richard G. Scott", "1988-10-06", "2015-09-22", []),
    ("Robert D. Hales", "1994-04-07", "2017-10-01", []),
    ("Jeffrey R. Holland", "1994-06-23", INF, []),
    ("Henry B. Eyring", "1995-04-01", INF, [("2007-10-06", INF)]),
    ("Dieter F. Uchtdorf", "2004-10-07", INF, [("2008-02-03", "2018-01-14")]),
    ("David A. Bednar", "2004-10-07", INF, []),
    ("Quentin L. Cook", "2007-10-11", INF, []),
    ("D. Todd Christofferson", "2008-04-10", INF, [("2025-10-14", INF)]),
    ("Neil L. Andersen", "2009-04-09", INF, []),
    ("Ronald A. Rasband", "2015-10-08", INF, []),
    ("Gary E. Stevenson", "2015-10-08", INF, []),
    ("Dale G. Renlund", "2015-10-08", INF, []),
    ("Gerrit W. Gong", "2018-03-31", INF, []),
    ("Ulisses Soares", "2018-03-31", INF, []),
    ("Patrick Kearon", "2023-12-07", INF, []),
]
# Auxiliary and general officers who spoke after 2018 (the printed-calling source ends in 2018)
AUX_LATE = ["Amy A. Wright", "Andrea Muñoz Spannaus", "Bonnie H. Cordon", "Camille N. Johnson", "Cristina B. Franco",
            "Emily Belle Freeman", "J. Anette Dennis", "Jean B. Bingham", "Joy D. Jones", "Kristin M. Yee", "Laudy Ruth Kaouk Alvarez",
            "Lisa L. Harkness", "Michelle D. Craig", "Rebecca L. Craven", "Reyna I. Aburto", "Rosemary K. Chibota", "Sharon Eubank",
            "Susan H. Porter", "Tamara W. Runia", "Tracy Y. Browning", "Ahmad S. Corbitt", "Bradley R. Wilcox", "Steven J. Lund",
            "Mark L. Pace", "Milton Camargo", "Jan E. Newman", "Stephen W. Owen", "Douglas D. Holmes", "M. Joseph Brough",
            "Devin G. Durrant", "Brian K. Taylor", "Chad H Webb"]
WOMEN_EXTRA = set(AUX_LATE[:20])
# men in Young Men / Sunday School presidencies (auxiliary, not women); Seventies caught by the women's-session rule
MEN_AUX = {"A. Roger Merrill", "Adrián Ochoa", "Ahmad S. Corbitt", "Bradley R. Wilcox", "Brian K. Ashton", "Chad H Webb", "Daniel K Judd",
           "David L. Beck", "David M. McConkie", "Dean R. Burgess", "Devin G. Durrant", "Douglas D. Holmes", "Fono Lavatai", "Jan E. Newman",
           "Larry M. Gibson", "M. Joseph Brough", "Mark L. Pace", "Matthew O. Richardson", "Michael A. Neider", "Milton Camargo",
           "Randall L. Ridd", "Russell T. Osguthorpe", "Stephen W. Owen", "Steven J. Lund", "Tad R. Callister", "William D. Oswald",
           "Charles W. Dahlquist II", "Robert K. Dellenbach", "Robert L. Backman", "Jack H Goaslind Jr.", "Vaughn J. Featherstone"}
SEVENTY_FIX = {"Dean L. Larsen", "J. Thomas Fyans"}


def norm(s):
    s = unicodedata.normalize("NFKC", str(s)).replace("\xa0", " ")
    s = re.sub(r"\b(Prest|Pres|Elder|Eldee|Eldeb|Eldkr|Coustselok|Counselor|President|Bishop|Sister|Brother)\b\.?", " ", s, flags=re.I)
    fixes = {"oeson phatt": "orson pratt", "beigham": "brigham", "wilfoed": "wilford", "tayloe": "taylor", "fbanklin d. bichaeds": "franklin d. richards",
             "kwoodruff": "woodruff", "younggod": "young", "cowleybeneficial": "cowley", "woodruffthe": "woodruff"}
    s = s.lower()
    for a, b in fixes.items():
        s = s.replace(a, b)
    s = re.sub(r"[^a-záéíóúñüç\s.]", " ", s)
    return re.sub(r"\s+", " ", s).strip(" .")


def canon_key(s):
    return re.sub(r"[^a-z]", "", norm(s))


TABLE = {canon_key(n): (n, pd.Timestamp(a), pd.Timestamp(b), [(pd.Timestamp(x), pd.Timestamp(y)) for x, y in fp]) for n, a, b, fp in APOSTLES}
KEYS = list(TABLE)


def apostle(name):
    k = canon_key(name)
    if k in TABLE:
        return TABLE[k]
    m = difflib.get_close_matches(k, KEYS, n=1, cutoff=0.86)
    if m:
        return TABLE[m[0]]
    # OCR'd names with trailing title junk: try the first 3-4 tokens
    toks = norm(name).split()
    for n in (4, 3, 2):
        k2 = re.sub(r"[^a-z]", "", " ".join(toks[:n]))
        m = difflib.get_close_matches(k2, KEYS, n=1, cutoff=0.86)
        if m:
            return TABLE[m[0]]
    return None


def calling_rank(c):
    c = (c or "").strip().lower()
    if not c:
        return None
    if "first presidency" in c and "secretary" not in c or c.startswith("president of the church"):
        return "FP"
    if "twelve" in c and "assistant" not in c:
        return "Q12"
    if any(w in c for w in ("seventy", "assistant to", "presiding bishop", "patriarch")):
        return "GA"
    return "AUX"


t = pd.read_parquet(talks_path, columns=["talk_id", "source", "date", "year", "speaker", "title", "cite", "where"])
t["speaker_n"] = t.speaker.map(lambda s: unicodedata.normalize("NFKC", str(s)).replace("\xa0", " ").strip())
jw = pd.read_csv(jw_path)
jw["slug"] = jw.url.str.extract(r"general-conference/(\d{4}/\d{2}/[^?]+)")[0]
t["slug"] = t.cite.str.extract(r"general-conference/(\d{4}/\d{2}/[^?]+)")[0]
jw_rank = jw.dropna(subset=["slug"]).drop_duplicates("slug").set_index("slug").calling.map(calling_rank)
t["printed_rank"] = t.slug.map(jw_rank)
# carry a speaker's printed rank to their unlabeled talks, nearest date first
t = t.sort_values("date")
filled = []
for sp, g in t.groupby("speaker_n"):
    known = g.dropna(subset=["printed_rank"])
    for idx, r in g.iterrows():
        if pd.notna(r.printed_rank) or known.empty or pd.isna(r.date):
            filled.append((idx, r.printed_rank))
        else:
            j = (known.date - r.date).abs().idxmin()
            filled.append((idx, known.loc[j, "printed_rank"]))
t["carried_rank"] = pd.Series(dict(filled))

# Speakers without a printed calling who spoke in a women's, Relief Society or Young Women session and are not
# apostles: auxiliary leaders (women's sessions are otherwise addressed by apostles, already caught by the table)
ws = t[t["where"].fillna("").str.contains("Women|Relief Society|Young Women|Primary", case=False)]
WOMENS_SESSION = {n for n in ws.speaker_n.unique() if apostle(n) is None and n not in SEVENTY_FIX and
                  not t.loc[t.speaker_n.eq(n), "carried_rank"].isin(["GA", "FP", "Q12"]).any()}
ranks, sources = [], []
for _, r in t.iterrows():
    a = apostle(r.speaker_n)
    d = r.date if pd.notna(r.date) else pd.Timestamp(f"{int(r.year) if pd.notna(r.year) else 1860}-07-01")
    rank, src = None, None
    if a is not None:
        _, a0, a1, fps = a
        if any(x <= d <= y for x, y in fps):
            rank, src = "FP", "table"
        elif a0 <= d <= a1:
            rank, src = "Q12", "table"
    if rank is None and pd.notna(r.carried_rank) and r.carried_rank not in ("FP", "Q12"):
        rank, src = r.carried_rank, "printed"
    if rank is None and (r.speaker_n in AUX_LATE or r.speaker_n in WOMENS_SESSION):
        rank, src = "AUX", "aux list"
    if rank is None:
        if r.source == "General Conference" or (r.source == "Conference Report" and r.year == 1970):
            rank, src = ("GA", "default")
        else:
            rank, src = ("OTHER", "default")
    ranks.append(rank)
    sources.append(src)
t["rank"], t["rank_source"] = ranks, sources
fem_slugs = set(jw.loc[jw.calling.str.contains("Relief Society|Young Women|Primary", na=False), "slug"])
fem_names = (set(t.loc[t.slug.isin(fem_slugs), "speaker_n"]) | WOMEN_EXTRA | WOMENS_SESSION) - MEN_AUX - SEVENTY_FIX
t["woman"] = t.speaker_n.isin(fem_names)
t[["talk_id", "source", "year", "speaker", "speaker_n", "rank", "rank_source", "woman"]].to_csv(out, index=False)
print(pd.crosstab(pd.cut(t.year, [1830, 1886, 1897, 1970, 1978, 1990, 2005, 2018, 2026]), t["rank"]).to_string())
print(t.rank_source.value_counts().to_dict(), "women talks:", int(t.woman.sum()))
x = t[(t.source == "General Conference") & t["rank"].isin(["FP", "Q12"])]
print("FP/Q12 talks by year sample:", x.groupby("year").size().reindex([1972, 1978, 1990, 2005, 2018, 2025]).to_dict())
