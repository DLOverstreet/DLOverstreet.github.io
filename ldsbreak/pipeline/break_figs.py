"""Figures for the breakpoint study. Nineteenth-century and modern data never share a line chart or a y-axis.

Usage: python3 -I break_figs.py <out_dir> <fig_dir>
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

out, figs = sys.argv[1:3]
os.makedirs(figs, exist_ok=True)
BLUE, ORANGE, GREEN, GOLD = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
INK, MUTED, GRID, SURF, GRAY = "#1f2328", "#5b636e", "#e3e6ea", "#ffffff", "#9aa1aa"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "axes.grid.axis": "y", "grid.color": GRID, "grid.linewidth": 0.8, "figure.facecolor": SURF,
                     "axes.facecolor": SURF, "axes.titleweight": "bold", "axes.titlesize": 11, "axes.titlelocation": "left",
                     "lines.linewidth": 2})
RANKC = {"FP": BLUE, "Q12": ORANGE, "GA": GREEN, "AUX": GOLD}
RANKL = {"FP": "First Presidency", "Q12": "Quorum of the Twelve", "GA": "Seventies / other GAs", "AUX": "Auxiliary leaders"}
DIML = {"D1": "D1 commandment (−) ↔ opportunity (+)", "D2": "D2 fear (−) ↔ love (+)",
        "D3": "D3 particularism (−) ↔ universalism (+)", "D4": "D4 institutional (−) ↔ personal (+)"}


def note(fig, s, y=0.01):
    fig.text(0.01, y, s, ha="left", va="bottom", fontsize=7.5, color=MUTED, wrap=True)


def spread(vals, gap):
    """Nudge end-label positions apart so no two sit closer than `gap` (data units)."""
    order = np.argsort(vals)
    pos = np.array(vals, dtype=float)
    for a, b in zip(order[:-1], order[1:]):
        if pos[b] - pos[a] < gap:
            pos[b] = pos[a] + gap
    return pos


def vlines(ax, years, labels=None):
    for i, yr in enumerate(years):
        ax.axvline(yr, color=MUTED, lw=1, ls="--", zorder=1)
        if labels:
            ax.text(yr, 1.0, " " + labels[i], transform=ax.get_xaxis_transform(), fontsize=7.5, color=MUTED, va="top", ha="left")


# ---- Fig 1: race rhetoric by period (teacher census of GC race passages; JoD sample on its own panel) ----
rp = pd.read_csv(f"{out}/race_teacher_periods.csv")
jod, gc = rp[rp.period.str.startswith("JoD")], rp[~rp.period.str.startswith("JoD")].dropna(subset=["relevant"])
fig, ax = plt.subplots(2, 2, figsize=(11, 7.2), gridspec_kw={"width_ratios": [1, 5]})
for a, d, ttl in [(ax[0, 0], jod, "Journal of Discourses"), (ax[0, 1], gc, "General Conference")]:
    x = np.arange(len(d))
    a.bar(x, d.D3, width=0.55, color=[BLUE if v >= 0 else ORANGE for v in d.D3], zorder=2)
    for xi, v, n in zip(x, d.D3, d.relevant):
        a.text(xi, v + (0.03 if v >= 0 else -0.03), f"{v:+.2f}\nn={int(n)}", ha="center", va="bottom" if v >= 0 else "top", fontsize=8, color=INK)
    a.set_xticks(x, d.period.str.replace(" ", "\n", n=1), fontsize=8)
    a.axhline(0, color=MUTED, lw=0.8)
    a.set_title(ttl, fontsize=10)
ax[0, 0].set_ylim(-0.8, 0.2)
ax[0, 1].set_ylim(0, 1.0)
ax[0, 0].set_ylabel("Mean D3 (− particularist, + universalist)")
FL = [("flag_E", "Equality / 2 Ne 26:33", BLUE), ("flag_A", "Racism condemned", ORANGE), ("flag_V", "1978 revelation cited", GREEN),
      ("flag_G", "Church growth among Black people", GOLD)]
x = np.arange(len(gc))
ends = spread([100 * gc[c].iloc[-1] for c, _, _ in FL], 5)
for (c, lab, col), yl in zip(FL, ends):
    ax[1, 1].plot(x, 100 * gc[c], marker="o", ms=6, color=col, label=lab)
    ax[1, 1].plot([x[-1] + 0.2], [yl], marker="o", ms=5, color=col, clip_on=False)
    ax[1, 1].text(x[-1] + 0.32, yl, lab, fontsize=7.5, color=INK, va="center")
ax[1, 1].set_xticks(x, gc.period.str.replace(" ", "\n", n=1), fontsize=8)
ax[1, 1].set_xlim(-0.3, len(gc) + 1.6)
ax[1, 1].set_ylim(0, 80)
ax[1, 1].set_title("Content of relevant race passages", fontsize=10)
JF = [("flag_L", "Lineage / curse", ORANGE), ("flag_S", "Slavery", GOLD), ("flag_E", "Equality", BLUE), ("flag_R", "Restriction", GREEN)]
ax[1, 0].bar(np.arange(len(JF)), [100 * jod[c].iloc[0] for c, _, _ in JF], color=[c for _, _, c in JF], width=0.6, zorder=2)
ax[1, 0].set_xticks(np.arange(len(JF)), [lab for _, lab, _ in JF], rotation=45, ha="right", fontsize=7.5)
ax[1, 0].set_ylim(0, 80)
ax[1, 0].set_ylabel("% of relevant passages")
ax[1, 0].set_title("1851–86", fontsize=10)
fig.suptitle("Race rhetoric: already universalist in conference before 1978; condemning racism mainly from the mid-2010s", x=0.01, ha="left", fontweight="bold")
note(fig, "Teacher codes. General Conference: every passage matching the race dictionary, 1971–2026 (census, 311 candidates; relevant passages shown). "
          "Journal of Discourses: random 70 of 141 candidates. Conference text for 1887–1969 is unavailable. The two panels in each row use separate y-axes.")
fig.tight_layout(rect=(0, 0.05, 1, 0.96))
fig.savefig(f"{figs}/fig1_race_by_period.png", dpi=200)
plt.close(fig)

# ---- Event-study helper ----
ev = pd.read_csv(f"{out}/event_study.csv")


def event_panel(ax, g, width, breaks, labels, ref_note):
    g = g.sort_values("k")
    xc = g.start + width / 2
    ax.axhline(0, color=MUTED, lw=0.8)
    ax.fill_between(xc, g.beta - 1.96 * g.se, g.beta + 1.96 * g.se, color=BLUE, alpha=0.15, lw=0)
    ax.plot(xc, g.beta, color=BLUE, marker="o", ms=5)
    ref = g[g.se == 0]
    ax.plot(ref.start + width / 2, ref.beta, ls="none", marker="o", ms=7, mfc=SURF, mec=INK, label=ref_note)
    vlines(ax, breaks, labels)


fig, axs = plt.subplots(2, 2, figsize=(11, 7), sharex=True)
for a, d in zip(axs.flat, ["D1", "D2", "D3", "D4"]):
    g = ev[(ev.case == "RACE") & (ev.bin_years == 4) & (ev.outcome == d)]
    event_panel(a, g, 4, [1978.45, 2014, 2020.5], ["OD 2", "essay", "2020"], "reference bin")
    a.set_title(DIML[d], fontsize=10)
axs[0, 0].legend(frameon=False, fontsize=8, loc="lower left")
for a in axs[:, 0]:
    a.set_ylabel("Race minus controls (score units)")
fig.suptitle("Race passages relative to control topics, 4-year bins (reference: 1974–June 1978)", x=0.01, ha="left", fontweight="bold")
note(fig, "Event-study coefficients from passage-level WLS with topic and conference fixed effects, weighted by the student's relevance probability; "
          "bands are 95% intervals clustered by talk. Controls: tithing, Word of Wisdom, Sabbath, prayer/scripture study, welfare, chastity.")
fig.tight_layout(rect=(0, 0.05, 1, 0.96))
fig.savefig(f"{figs}/fig2_race_event_study.png", dpi=200)
plt.close(fig)

# ---- Fig 3: break-date scan ----
POS = {"D1": "D1 toward opportunity", "D2": "D2 toward love", "D3": "D3 toward universalism", "D4": "D4 toward personal"}
sc = pd.read_csv(f"{out}/break_scan.csv")
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2), sharey=True)
for a, case, dims, brk, lab in [(axs[0], "RACE", [("D3", BLUE), ("D2", ORANGE), ("D4", GREEN)], [1978, 2014, 2020], ["OD 2", "essay", "2020"]),
                                (axs[1], "MINISTER", [("D1", BLUE), ("D2", ORANGE), ("D4", GREEN)], [2018], ["ministering"])]:
    for d, col in dims:
        g = sc[(sc.case == case) & (sc.outcome == d)]
        a.plot(g.tau, g.t, color=col, label=POS[d])
    a.axhspan(-1.96, 1.96, color=GRID, alpha=0.6, lw=0)
    vlines(a, brk, lab)
    a.set_title("Race vs controls" if case == "RACE" else "Ministering vs controls", fontsize=10)
    a.legend(frameon=False, fontsize=8, loc="lower right" if case == "RACE" else "lower left")
axs[0].set_ylabel("t-statistic of a treated × post step at year τ")
fig.suptitle("Where does the treated-minus-control gap break? A scan over candidate break years", x=0.01, ha="left", fontweight="bold")
note(fig, "Each point re-estimates the difference-in-differences with the break placed at January of year τ (topic + conference fixed effects, talk-clustered SEs). "
          "Positive t = the treated topic moves toward the positive pole relative to controls. Gray band: |t| < 1.96.")
fig.tight_layout(rect=(0, 0.08, 1, 0.93))
fig.savefig(f"{figs}/fig3_break_scan.png", dpi=200)
plt.close(fig)

# ---- Fig 4: ministering event study (annual) ----
fig, axs = plt.subplots(2, 2, figsize=(11, 7), sharex=True)
for a, d in zip(axs.flat, ["D1", "D2", "D3", "D4"]):
    g = ev[(ev.case == "MINISTER") & (ev.bin_years == 1) & (ev.outcome == d)]
    event_panel(a, g, 1, [2018.2], ["April 2018"], "reference years (2015–17)")
    a.set_title(DIML[d], fontsize=10)
axs[0, 0].legend(frameon=False, fontsize=8, loc="lower left")
for a in axs[:, 0]:
    a.set_ylabel("Ministering minus controls")
fig.suptitle("Ministering/home-teaching passages relative to control topics, by year", x=0.01, ha="left", fontweight="bold")
note(fig, "Event-study coefficients (passage-level WLS, topic + conference fixed effects, relevance weights; 95% intervals clustered by talk). "
          "End bins pool 1990–2004 and 2026.")
fig.tight_layout(rect=(0, 0.04, 1, 0.96))
fig.savefig(f"{figs}/fig4_minister_event_study.png", dpi=200)
plt.close(fig)

# ---- Fig 5: synthetic control, ministering ----
ss = pd.read_csv(f"{out}/synth_series.csv")
sm_ = pd.read_csv(f"{out}/synth_summary.csv")
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2))
for a, d in zip(axs, ["D1", "D4"]):
    g = ss[(ss.case == "MINISTER") & (ss.outcome == d)]
    a.plot(g.year, g.synthetic, color=GRAY, ls="--", label="Synthetic (weighted controls)")
    a.plot(g.year, g.treated, color=BLUE, label="Ministering / home teaching")
    vlines(a, [2017.5], ["April 2018"])
    r = sm_[(sm_.case == "MINISTER") & (sm_.outcome == d) & sm_.is_treated].iloc[0]
    a.set_title(DIML[d], fontsize=10)
    a.text(0.99, 0.03, f"post gap {r.mean_post_gap:+.2f}; RMSPE ratio {r.ratio:.2f}; placebo rank p={r.perm_p:.2f}", transform=a.transAxes,
           ha="right", fontsize=8, color=INK)
axs[0].legend(frameon=False, fontsize=8, loc="upper left")
fig.suptitle("Synthetic control: ministering vs a weighted blend of control topics (annual means)", x=0.01, ha="left", fontweight="bold")
note(fig, "De-meaned synthetic control fit on 1996–2017; donors are the six control topics. Placebo p = rank of the post/pre RMSPE ratio among the treated topic "
          "and six placebo runs (minimum attainable 0.14).")
fig.tight_layout(rect=(0, 0.06, 1, 0.93))
fig.savefig(f"{figs}/fig5_minister_synth.png", dpi=200)
plt.close(fig)

# ---- Fig 6: vocabulary compliance and diffusion by rank (talk level) ----
lx = pd.read_csv(f"{out}/lexical_by_conf_rank.csv")
lx["year"] = lx.conf.str[:4].astype(int)


def yearly(col, ranks=None):
    d = lx if ranks is None else lx[lx["rank"].isin(ranks)]
    d = d.assign(hits=d[col] * d.talks)
    key = ["year"] if ranks is None else ["year", "rank"]
    g = d.groupby(key)[["hits", "talks"]].sum()
    return (100 * g.hits / g.talks).rename(col).reset_index()


fig, axs = plt.subplots(1, 3, figsize=(13, 4.3))
a = axs[0]
for col, c, lab in [("old_ht_vt", ORANGE, "“home/visiting teaching”"), ("ministering_program", BLUE, "“ministering”")]:
    g = yearly(col)
    g = g[g.year >= 2008]
    a.plot(g.year, g[col], color=c, marker="o", ms=4)
    a.text(g.year.iloc[-1] + 0.3, g[col].iloc[-1], lab, fontsize=8, color=INK, va="center")
vlines(a, [2018.2], ["Apr 2018"])
a.set_xlim(2007.5, 2030.5)
a.set_title("Program vocabulary (all speakers)", fontsize=10)
a.set_ylabel("% of talks using the term")
lc = pd.read_csv(f"{out}/lexical_compliance.csv")
for a, term, ttl, wl in [(axs[1], "mormon_name", "“Mormon(s)”, “LDS” as a name, by rank",
                          {"2014-01..2018-06": "2014–\nJun 2018", "2018-09..2019-12": "Sep 2018–\n2019", "2020-01..2022-12": "2020–22", "2023-01..2026-12": "2023–26"}),
                         (axs[2], "old_ht_vt", "“home/visiting teaching”, by rank",
                          {"2014-01..2017-12": "2014–17", "2018-03..2019-12": "2018–19", "2020-01..2022-12": "2020–22", "2023-01..2026-12": "2023–26"})]:
    g = lc[(lc.term == term) & lc.window.isin(wl)]
    xw = np.arange(len(wl))
    for j, (r, c) in enumerate(RANKC.items()):
        h = g[g["rank"] == r].set_index("window").reindex(list(wl))
        a.bar(xw + (j - 1.5) * 0.2, 100 * h.share_of_talks.fillna(0), width=0.18, color=c, label=RANKL[r], zorder=2)
    a.set_xticks(xw, list(wl.values()), fontsize=8)
    a.set_title(ttl, fontsize=10)
axs[1].legend(frameon=False, fontsize=7.5, loc="upper right")
axs[1].set_ylabel("% of talks using the term")
fig.suptitle("Vocabulary: who adopts the new words, and who keeps the old ones", x=0.01, ha="left", fontweight="bold")
note(fig, "Share of General Conference talks using each term at least once (left: per year, all speakers; middle and right: by rank and window). "
          "“Mormon” counts exclude “Book of Mormon” and the prophet Mormon; the Sep 2018–2019 First Presidency bar is President Nelson's own talk on the name. "
          "“Ministering” excludes “ministering of angels/spirits”.")
fig.tight_layout(rect=(0, 0.06, 1, 0.93))
fig.savefig(f"{figs}/fig6_vocabulary_by_rank.png", dpi=200)
plt.close(fig)

# ---- Fig 7: attention ----
sa = pd.read_csv(f"{out}/series_annual.csv")
CON = ["TITHING", "WOW", "SABBATH", "PRAYER", "WELFARE", "CHASTITY"]
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2))
for a, case, brk, lab in [(axs[0], "RACE", [1978.45, 2014, 2020.5], ["OD 2", "essay", "2020"]), (axs[1], "MINISTER", [2018.2], ["April 2018"])]:
    g = sa[sa.topic == case].sort_values("year")
    c = sa[sa.topic.isin(CON)].pivot(index="year", columns="topic", values="per1000").reindex(range(1970, 2027)).fillna(0).mean(axis=1)
    a.plot(c.index, c.values, color=GRAY, lw=1.6, label="Average control topic")
    a.plot(g.year, g.per1000, color=BLUE, label="Race" if case == "RACE" else "Ministering / home teaching")
    vlines(a, brk, lab)
    a.set_title(("Race" if case == "RACE" else "Ministering") + ": relevant passages per 1,000 conference passages", fontsize=10)
    a.legend(frameon=False, fontsize=8, loc="upper left")
axs[0].set_ylabel("Relevance-weighted passages per 1,000")
fig.suptitle("Attention: how much conference time each topic receives, 1970–2026", x=0.01, ha="left", fontweight="bold")
note(fig, "Sum of the student's relevance probabilities for dictionary-matched passages, divided by all conference passages that year.")
fig.tight_layout(rect=(0, 0.05, 1, 0.93))
fig.savefig(f"{figs}/fig7_attention.png", dpi=200)
plt.close(fig)

# ---- Fig 8: DiD by rank ----
rd = pd.read_csv(f"{out}/rank_did.csv")
rd = rd[rd.outcome.isin(["D1", "D2", "D3", "D4"])]
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2), sharey=True)
for a, case, dims in [(axs[0], "RACE", ["D3", "D4"]), (axs[1], "MINISTER", ["D1", "D4"])]:
    for j, (d, col) in enumerate(zip(dims, [BLUE, ORANGE])):
        g = rd[(rd.case == case) & (rd.outcome == d)].set_index("rank").reindex(list(RANKC))
        x = np.arange(len(g)) + (j - 0.5) * 0.25
        a.errorbar(x, g.beta, yerr=1.96 * g.se, fmt="o", ms=7, color=col, ecolor=col, elinewidth=1.5, capsize=3, label=DIML[d])
    a.axhline(0, color=MUTED, lw=0.8)
    a.set_xticks(np.arange(4), [RANKL[r].replace(" / ", "/\n").replace(" leaders", "\nleaders").replace("Quorum of the", "Quorum of\nthe") for r in RANKC], fontsize=8)
    a.set_title(("Race: 1978 step" if case == "RACE" else "Ministering: 2018 step") + " estimated within each rank", fontsize=10)
    a.legend(frameon=False, fontsize=7.5, loc="lower left")
axs[0].text(3, 0.05, "no auxiliary\nrace passages\nbefore 1978", ha="center", fontsize=8, color=MUTED)
axs[0].set_ylabel("Difference-in-differences (score units)")
fig.suptitle("Does the break filter down the hierarchy? Treated-minus-control steps by speaker rank", x=0.01, ha="left", fontweight="bold")
note(fig, "Full 1970–2026 span; each rank's passages only (treated and control). Points: DiD estimates; bars: 95% intervals clustered by talk.")
fig.tight_layout(rect=(0, 0.05, 1, 0.93))
fig.savefig(f"{figs}/fig8_rank_did.png", dpi=200)
plt.close(fig)

# ---- Fig 9: ministering teacher flags by period ----
mp = pd.read_csv(f"{out}/minister_teacher_periods.csv")
fig, axs = plt.subplots(1, 2, figsize=(11, 4.2), sharey=True)
x = np.arange(len(mp))
for a, fl in [(axs[0], [("H", "“home/visiting teaching” vocabulary", ORANGE), ("M", "“ministering” vocabulary", BLUE)]),
              (axs[1], [("P", "Program metrics (percentages, reports)", ORANGE), ("C", "Care for the individual", BLUE)])]:
    for f, lab, col in fl:
        a.plot(x, 100 * mp[f], color=col, marker="o", ms=6)
        a.text(x[-1] + 0.15, 100 * mp[f].iloc[-1], lab, fontsize=7.5, color=INK, va="center")
    a.axvline(5.5, color=MUTED, lw=1, ls="--")
    a.set_xticks(x, mp.bin.str.replace("-", "–\n"), fontsize=8)
    a.set_xlim(-0.3, len(mp) + 2.6)
axs[0].set_ylabel("% of relevant ministering passages")
axs[0].set_title("Vocabulary switches at once", fontsize=10)
axs[1].set_title("Care displaced metrics decades earlier", fontsize=10)
fig.suptitle("Home teaching → ministering in teacher-coded passages", x=0.01, ha="left", fontweight="bold")
note(fig, "Teacher codes on 147 sampled ministering-dictionary passages (15 per period before 2018, 30 after), relevant passages only "
          "(n = 4–12 per period, so each point is coarse).")
fig.tight_layout(rect=(0, 0.06, 1, 0.93))
fig.savefig(f"{figs}/fig9_minister_teacher_flags.png", dpi=200)
plt.close(fig)
print("figures written to", figs)
