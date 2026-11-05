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

# ---- Fig 2: flagged passages per 1,000 by five-year period ----
per = pd.read_csv(os.path.join(out, "cn_by_period.csv"))
per["x"] = per.period.str[:4].astype(int) + 2.5
per.loc[per.period.isin(["1885", "2025"]), "x"] -= 1.5  # these periods cover only two years (1885-86, 2025-26)
cr = per.period.str.contains("CR")
per.loc[cr, "x"] = per.loc[cr, "period"].str[:4].astype(int) + 0.5
reg = per[~cr]
fig, ax = plt.subplots(figsize=(10, 4.8))
ax.axvspan(1887, 1969, color="#f2f3f5", zorder=0)
ax.text(1928, 41, "1887–1969: conference text not in corpus\n(except the Apr 1880, Oct 1897 and 1970 reports, shown as points)",
        ha="center", va="top", fontsize=8.5, color=MUTED)
for col, c, lab in (("flag_agree_per1000", BLUE, "Agrees"), ("flag_disagree_per1000", ORANGE, "Disagrees")):
    for seg in (reg[reg.x < 1890], reg[reg.x > 1965]):
        ax.plot(seg.x, seg[col], color=c, lw=2, marker="o", ms=5, zorder=3, label=lab if seg.x.min() < 1890 else None)
    ax.scatter(per.loc[cr, "x"], per.loc[cr, col], color=c, marker="D", s=40, zorder=4, edgecolor=SURF, linewidth=1.5)
ax.set_ylim(0, 92)
ax.set_xlim(1848, 2030)
ax.set_ylabel("Passages per 1,000")
ax.set_title("Passages the model flags as taking a Christian nationalism position, by five-year period")
ax.legend(frameon=False, loc="upper right")
pk = reg.loc[reg.flag_disagree_per1000.idxmax()]
ax.annotate("1885–86: the anti-polygamy “Raid”\nunder the Edmunds Act; sermons against\nCongress legislating Christian monogamy", (pk.x, pk.flag_disagree_per1000), (1893, 78),
            fontsize=8, color=INK, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
b = reg[reg.period == "1975"].iloc[0]
ax.annotate("1975–79: Benson, Petersen and the\nBicentennial: “serve the God of the\nland, who is Jesus Christ”", (b.x, b.flag_agree_per1000), (1985, 33),
            fontsize=8, color=INK, arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.8))
note(fig, "Flagged = student salience score above the threshold that gives 60% out-of-fold precision (recall 60%); split by the predicted direction of the "
          "passage. Counts after 1980 are small (1–10 passages per period), so year-to-year wiggles there are noise.")
fig.tight_layout(rect=(0, 0.06, 1, 1))
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

# ---- Fig 4: supplemental codes, small multiples ----
fig, axs = plt.subplots(2, 2, figsize=(10, 6), sharex=True)
for ax, (c, col, title) in zip(axs.flat, (("THEO", BLUE, "Kingdom of God / Zion theocracy"), ("ANTI", ORANGE, "U.S. as Babylon or persecutor"),
                                          ("AMER", GREEN, "American civil religion"), ("LIB", GOLD, "Religious liberty for all"))):
    ax.axvspan(1887, 1969, color="#f2f3f5", zorder=0)
    for seg in (reg[reg.x < 1890], reg[reg.x > 1965]):
        ax.plot(seg.x, 100 * seg[c], color=col, lw=2, zorder=3)
    ax.scatter(per.loc[cr, "x"], 100 * per.loc[cr, c], color=col, marker="D", s=28, zorder=4, edgecolor=SURF, linewidth=1.2)
    ax.set_title(title, fontsize=10.5)
    ax.set_ylim(0, None)
    ax.set_ylabel("% of passages", fontsize=8.5)
fig.suptitle("Related themes, by five-year period", x=0.01, ha="left", fontweight="bold", fontsize=12)
note(fig, "Mean calibrated student probability that a passage carries each code (AUC 0.87–0.95 against the teacher codes). The calibration has a floor "
          "of a few percent, so low values overstate rare themes. Grey band: 1887–1969 not in corpus; diamonds: 1880, 1897, 1970 Conference Reports.")
fig.tight_layout(rect=(0, 0.06, 1, 0.96))
fig.savefig(os.path.join(figs, "fig4_related_themes.png"), dpi=200)
print("figures written to", figs)
