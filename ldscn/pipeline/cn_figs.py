"""Figures for the Christian nationalism results.

Usage: python3 -I cn_figs.py <out_dir> <fig_dir>
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
INK, MUTED, GRID, SURF = "#1f2328", "#5b636e", "#e3e6ea", "#ffffff"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": MUTED,
                     "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "axes.grid.axis": "y", "grid.color": GRID, "grid.linewidth": 0.8, "figure.facecolor": SURF,
                     "axes.facecolor": SURF, "axes.titleweight": "bold", "axes.titlesize": 12, "axes.titlelocation": "left"})
ERAS = ["1850-69", "1870-86", "CR 1880/1897/1970", "1971-89", "1990-2009", "2010-26"]
ELAB = ["1850–69\nJoD", "1870–86\nJoD", "1880, 1897,\n1970 Conf.\nReports", "1971–89\nGen. Conf.", "1990–2009\nGen. Conf.", "2010–26\nGen. Conf."]
note = lambda fig, s: fig.text(0.01, 0.01, s, ha="left", va="bottom", fontsize=8, color=MUTED, wrap=True)

# ---- Fig 1: agree vs disagree by era (model-assisted estimates, 90% intervals) ----
lv = pd.read_csv(os.path.join(out, "cn_era_estimates_long.csv"))
fig, ax = plt.subplots(figsize=(9, 5))
x = np.arange(len(ERAS))
for k, (t, col, lab) in enumerate((("agree", BLUE, "Agrees with a PRRI item"), ("disagree", ORANGE, "Disagrees with a PRRI item"))):
    g = lv[lv.target == t].set_index("era").reindex(ERAS)
    xs = x + (k - 0.5) * 0.36
    ax.bar(xs, 100 * g.model_assisted, width=0.34, color=col, label=lab, zorder=2)
    ax.errorbar(xs, 100 * g.model_assisted, yerr=[100 * (g.model_assisted - g.lo), 100 * (g.hi - g.model_assisted)],
                fmt="none", ecolor=INK, elinewidth=1, capsize=3, zorder=3)
    for xi, v, h in zip(xs, g.model_assisted, g.hi):
        ax.text(xi, 100 * h + 0.4, f"{100 * v:.1f}", ha="center", va="bottom", fontsize=8, color=INK)
ax.set_xticks(x, ELAB, fontsize=8.5)
ax.set_ylabel("% of passages")
ax.set_title("How often LDS leaders' passages agree or disagree with Christian nationalism")
ax.legend(frameon=False, loc="upper right")
ax.set_ylim(0, 36)
note(fig, "Share of ~300-word passages that take a position on any of PRRI's five Christian nationalism statements. Model-assisted survey estimates "
          "(student model + design-weighted teacher correction); bars show 90% bootstrap intervals. Conference text for 1887–1969 is not available "
          "except Apr 1880, Oct 1897 and 1970; that column rests on 30 coded passages.")
fig.tight_layout(rect=(0, 0.07, 1, 1))
fig.savefig(os.path.join(figs, "fig1_agree_disagree_by_era.png"), dpi=200)

# ---- Fig 2: flagged passages per 1,000 by five-year period, 19th century and modern era on separate scales ----
per = pd.read_csv(os.path.join(out, "cn_by_period.csv"))
per["x"] = per.period.str[:4].astype(int) + 2.5
per.loc[per.period.isin(["1885", "2025"]), "x"] -= 1.5  # these periods cover only two years (1885-86, 2025-26)
cr = per.period.str.contains("CR")
per.loc[cr, "x"] = per.loc[cr, "period"].str[:4].astype(int) + 0.5
per["old"] = per.x < 1950
SPANS = ((True, "1851–1897: Journal of Discourses + 1880, 1897 reports", (1849, 1900)),
         (False, "1970–2026: General Conference", (1968, 2029)))


def era_panel(ax, old, col, c, lab=None, scale=1, marker="o"):
    d = per[per.old == old]
    reg_, crd = d[~d.period.str.contains("CR")], d[d.period.str.contains("CR")]
    ax.plot(reg_.x, scale * reg_[col], color=c, lw=2, marker=marker, ms=5 if marker else 0, zorder=3, label=lab)
    ax.scatter(crd.x, scale * crd[col], color=c, marker="D", s=40, zorder=4, edgecolor=SURF, linewidth=1.5)


fig, axs = plt.subplots(1, 2, figsize=(11, 4.8))
for ax, (old, title, xl) in zip(axs, SPANS):
    for col, c, lab in (("flag_agree_per1000", BLUE, "Agrees"), ("flag_disagree_per1000", ORANGE, "Disagrees")):
        era_panel(ax, old, col, c, lab)
    ax.set_xlim(*xl)
    ax.set_ylim(0, None)
    ax.set_title(title, fontsize=10)
    ax.set_ylabel("Passages per 1,000")
axs[0].set_ylim(0, 100)
axs[1].set_ylim(0, 25)
axs[0].legend(frameon=False, loc="upper left")
pk = per.loc[per.flag_disagree_per1000.idxmax()]
axs[0].annotate("1885–86: the anti-polygamy “Raid”\nunder the Edmunds Act; sermons\nagainst Congress legislating\nChristian monogamy",
                (pk.x, pk.flag_disagree_per1000), (1852, 55), fontsize=8, color=INK, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
cr70 = per[per.period == "1970 CR"].iloc[0]
axs[1].annotate("1970 Conference Reports\n(Sill, Richards and others)", (cr70.x, cr70.flag_agree_per1000), (1976, 21.5),
                fontsize=8, color=INK, va="center", arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
bb = per[per.period == "1975"].iloc[0]
axs[1].annotate("1975–79: Benson, Petersen and the\nBicentennial: “serve the God of the\nland, who is Jesus Christ”", (bb.x, bb.flag_agree_per1000), (1986, 15),
                fontsize=8, color=INK, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
fig.suptitle("Passages the model flags as taking a Christian nationalism position, by five-year period", x=0.01, ha="left", fontweight="bold", fontsize=12)
note(fig, "The two panels have different vertical scales. Diamonds: single Conference Reports (Apr 1880, Oct 1897, 1970). Flagged = student salience score above "
          "the threshold that gives 60% out-of-fold precision (recall 60%), split by predicted direction. 1887–1969 is not in the corpus. Counts after 1980 are "
          "small (1–10 passages per period), so wiggles there are noise.")
fig.tight_layout(rect=(0, 0.08, 1, 0.95))
fig.savefig(os.path.join(figs, "fig2_flagged_by_period.png"), dpi=200)

# ---- Fig 3: PRRI-equivalent stance among coded passages that address an item ----
st = pd.read_csv(os.path.join(out, "cn_era_stance.csv")).set_index("era").reindex(ERAS)
fig, ax = plt.subplots(figsize=(9, 4.8))
for lo_, hi_, lab, shade in ((1, 1.5, "Rejecter", "#fbe3d8"), (1.5, 2.5, "Skeptic", "#fdf1ea"), (2.5, 3.5, "Sympathizer", "#eaf2fb"), (3.5, 4, "Adherent", "#d6e6f8")):
    ax.axhspan(lo_, hi_, color=shade, zorder=0)
    ax.text(-0.55, (lo_ + hi_) / 2, lab, va="center", ha="left", fontsize=8.5, color=MUTED)
ax.errorbar(x, st.teacher_prri, yerr=[st.teacher_prri - st.teacher_prri_lo, st.teacher_prri_hi - st.teacher_prri], fmt="o", color=INK, ms=7,
            ecolor=INK, elinewidth=1, capsize=3, zorder=3)
for xi, v, n in zip(x, st.teacher_prri, st.addressed_coded):
    ax.text(xi + 0.09, v, f"{v:.2f} (n={n})", va="center", fontsize=8, color=INK)
ax.set_xticks(x, ELAB, fontsize=8.5)
ax.set_ylim(1, 4)
ax.set_xlim(-0.6, len(ERAS) - 0.2)
ax.set_yticks([1, 2, 3, 4], ["1 Completely\ndisagree", "2 Mostly\ndisagree", "3 Mostly\nagree", "4 Completely\nagree"], fontsize=8)
ax.grid(False)
ax.set_title("When leaders do address it, where do they stand? PRRI-equivalent score by era")
note(fig, "Mean PRRI-equivalent score (1–4) of the item codes in teacher-coded passages that address at least one item, both coding rounds; "
          "90% bootstrap intervals; n = coded passages. 1990–2009 rests on only 4 passages.")
fig.tight_layout(rect=(0, 0.05, 1, 1))
fig.savefig(os.path.join(figs, "fig3_prri_stance_by_era.png"), dpi=200)

# ---- Fig 4: supplemental codes, small multiples; each era on its own scale ----
fig, axs = plt.subplots(4, 2, figsize=(10, 10), sharex="col")
THEMES = (("THEO", BLUE, "Kingdom of God / Zion theocracy"), ("ANTI", ORANGE, "U.S. as Babylon or persecutor"),
          ("AMER", GREEN, "American civil religion"), ("LIB", GOLD, "Religious liberty for all"))
for i, (c, col, title) in enumerate(THEMES):
    for j, (old, span, xl) in enumerate(SPANS):
        ax = axs[i, j]
        era_panel(ax, old, c, col, scale=100, marker=None)
        ax.set_xlim(*xl)
        ax.set_ylim(0, None)
        ax.set_title(f"{title}, {'1851–1897' if old else '1970–2026'}", fontsize=9.5)
        if j == 0:
            ax.set_ylabel("% of passages", fontsize=8.5)
fig.suptitle("Related themes, by five-year period", x=0.01, ha="left", fontweight="bold", fontsize=12)
note(fig, "Left and right columns have different vertical scales. Mean calibrated student probability that a passage carries each code (AUC 0.87–0.95 against "
          "the teacher codes); the calibration has a floor of a few percent, so low values overstate rare themes. Diamonds: Apr 1880, Oct 1897 and 1970 "
          "Conference Reports. 1887–1969 is not in the corpus.")
fig.tight_layout(rect=(0, 0.05, 1, 0.97))
fig.savefig(os.path.join(figs, "fig4_related_themes.png"), dpi=200)
print("figures written to", figs)
