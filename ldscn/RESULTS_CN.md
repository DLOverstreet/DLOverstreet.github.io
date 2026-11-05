# Christian nationalism in LDS general-authority discourse, 1851–2026: results

Measure: PRRI's five-item Christian Nationalism Scale (2023), coded passage by passage. Codebook: `CODEBOOK_CN.md`.
Corpus: 40,378 passages of ~300 words (13.4M words) from three sources:

- the Journal of Discourses, 1851–86;
- the April 1880, October 1897 and 1970 Conference Reports;
- General Conference, April 1971 to October 2026.

**1887–1969 is missing.** Those Conference Reports could not be reached from this environment.

## How the numbers were made

**Teacher codes.** 570 passages were coded on the five items (−2 to +2, 0 = not addressed) and four supplemental codes:

- **Round 1:** 450 passages, a probability sample stratified by era that over-samples passages with nation or government vocabulary. Inclusion probabilities are known.
- **Round 2:** 120 passages the round-1 model scored highest. They were added to give the model more examples of rare stances.

**Student model.** Every passage was scored with the same model family as the FRI work: TF-IDF + GloVe + lexicon features, logistic regression + gradient boosting.

| Target | Out-of-fold AUC (all labels / probability sample) |
|---|---|
| Addresses any item | 0.86 / 0.83 |
| Direction when it does (agree vs disagree) | 0.90 / 0.81 |
| Q2 law addressed | 0.88 / 0.82 |
| Q3 foundations addressed | 0.92 / 0.88 |
| THEO / AMER / ANTI / LIB | 0.91 / 0.96 / 0.92 / 0.91 |
| "Agree" modeled directly | 0.75 / 0.66 (weak, so not used) |

Agreement is therefore estimated as P(addresses) × P(agrees | addresses).

**Era levels.** These are model-assisted (difference) survey estimates: the student's population mean plus the design-weighted teacher-minus-student residual in the probability sample. They are design-unbiased, with 90% bootstrap intervals.

**Within-era change.** These are passages the student flags at a threshold with 60% out-of-fold precision and 60% recall. They are counted per 1,000 passages by five-year period and split by predicted direction.

## Findings

**1. Christian nationalism is rarely on the agenda.** At most about 5% of passages take a position on any PRRI statement, in any era with adequate data.

| Era | Addresses any item | Agrees | Disagrees | PRRI-equivalent when addressed (teacher, n) |
|---|---|---|---|---|
| 1850–69 (JoD) | 4.6% | 2.6% | 2.1% | 2.56 (27) — sympathizer/skeptic boundary |
| 1870–86 (JoD) | 5.0% | 0.8% | 4.3% | 1.78 (24) — skeptic |
| 1880 / 1897 / 1970 reports | 15.8% (90% CI 4–33) | 15.1% | 0.7% | 2.56 (12) |
| 1971–89 | 5.2% (1.4–11.7) | 4.9% | 0.3% | 3.15 (23) — sympathizer |
| 1990–2009 | ~0% (0–0.6) | ~0% | ~0% | 3.50 (4) — too few to classify |
| 2010–26 | 0.8% (0.2–1.5) | 0.5% | 0.3% | 2.29 (14) — skeptic |

The 1880/1897/1970 column mixes two different things. The April 1880 report is mostly disagreement (anti-polygamy-law sermons). The 1970 reports are almost entirely agreement (Sterling W. Sill, Franklin D. Richards and others).

**2. The direction flips over time.**

- **1850s–60s: mixed.**
  - *Agreement* takes three forms:
    - the Ether 2 covenant applied to the United States ("whatever nation shall possess this land … shall serve God … or be swept off": Orson Pratt, Brigham Young);
    - true religion as "the only sure foundation of … well-established government";
    - Saints' theocratic rule over the land.
  - *Disagreement* comes from the anti-establishment, free-exercise defense of plural marriage.
- **1870s–86: strongly disagreeing.** The Edmunds-era sermons (John Taylor, Erastus Snow, Moses Thatcher, Charles W. Penrose) attack Congress for writing Protestant Christian morality into law at the urging of "the orthodox pulpit." This is a direct rejection of Q2 (law based on Christian values) and sometimes of Q1 (establishment). Flagged disagreement peaks in 1885–86 at 88 per 1,000 passages.
- **1970s–80s: the high point of agreement.** Ezra Taft Benson, Mark E. Petersen, Sterling W. Sill and Vaughn J. Featherstone dominate. Most agreement is Q3:
  - America must "serve the God of the land, who is Jesus Christ" or be swept off;
  - liberty depends on a return "to the fundamental principles of Christianity and of constitutional government."
  - A handful of passages (5 coded) fuse faith and patriotism (Q4).
  - Benson has 17 flagged passages, all agreeing, the most of any modern speaker.

  The typical intensity is "mostly agree" (+1), not "completely": PRRI-equivalent 3.15.
- **1990–2009: near silence.** Hinckley's 2001 Ether 2:12 remarks and Wirthlin's 1994 talk are rare exceptions. So is the Church's advocacy on marriage law (Hinckley 1999, Ballard 2005), coded as mild Q2 agreement.
- **2010–26: low salience, leaning skeptic.**
  - *Disagreement* is mostly from Dallin H. Oaks (2020–21):
    - the Constitution's principles protect people of all faiths and none;
    - obey the law and accept election results.
  - Quentin L. Cook (2010) says religious moral positions deserve "equal access to the public square" but under most constitutions "may not be given preference." That passage is coded for and against at once.
  - *Agreement* is Q2 +1 on marriage and family policy: Oaks (2013), Cook, and Rasband (2025, on the proclamation's 30th anniversary).

**3. The 19th-century vocabulary was mostly something else.** About 28–30% of 19th-century passages carry Kingdom-of-God or Zion theocracy (THEO), and 17–23% cast the U.S. as Babylon or persecutor (ANTI). These are not American Christian nationalism. They are a rival, sectarian political theology, often explicitly opposed to the Protestant nation. Both themes fall to a few percent after 1970. American civil religion (AMER) and pluralist religious liberty (LIB) are present throughout but small.

**4. Talk-level PRRI categories.** No talk reaches "Adherent" (3.5+) on the model scores, because coded agreement is overwhelmingly +1, not +2.

Talks containing at least one flagged passage:

| Era | Sympathizer | Skeptic |
|---|---|---|
| 1850–69 | 60 | 59 |
| 1870–86 | 36 | 86 |
| 1971–89 | 27 | 4 |
| 1990–2009 | 9 | 2 |
| 2010–26 | 7 | 5 |

## Caveats

- **Coverage gap.** 1887–1969 is missing. That spans the Manifesto, statehood, the Smoot hearings and the Progressive, Depression and Cold War eras (J. Reuben Clark, McKay). The jump from 1886 to 1970 should not be read as a trend.
- **One coder.** One LLM coder produced the teacher codes; there is no inter-coder reliability yet. The natural next step is a human double-code of the 104 passages that address an item, plus a random 100.
- **Rare positives.** Era estimates for 1990–2009 and 2010–26 rest on very few coded positives, and the CR column on only 30 probability-sample passages. Treat these as orders of magnitude.
- **Construct fit.**
  - PRRI's items presuppose a Protestant-majority "Christian nation." Nineteenth-century Saints often rejected that nation while holding their own theocratic hopes; THEO and ANTI keep this from being scored as agreement.
  - Q3 agreement in LDS discourse runs largely through Book of Mormon covenant theology, not the founders-were-evangelicals narrative.
- **Speaker names** are taken from the sources. "Franklin D. Richards" merges the 19th-century apostle and the 20th-century Seventy.

## Files

- `out/cn_era_estimates*.csv`, `out/cn_era_stance.csv`, `out/cn_by_period.csv`: trends
- `out/cn_talk_categories.csv`, `out/cn_flagged_talks.csv`, `out/cn_speakers.csv`
- `out/cn_validation*.csv`, `out/cn_oof_predictions.csv`, `out/cn_flag_validation.csv`: validation
- `figs/`: figures 1–4
- Not committed, because they contain talk text, some of it Church-copyrighted: `data/*.parquet`, `labels/*_text.jsonl`, `out/cn_exemplars.jsonl`, `out/cn_scores.parquet`.
