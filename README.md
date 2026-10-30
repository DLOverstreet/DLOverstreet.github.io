# Official Voice Tracker: data and code

This branch holds the data, code and results for a study of official U.S. government messaging:
the President's own posts, the White House's website, and the State Department's X account,
2009–2026. Every post is scored on six rhetorical dimensions. The study design extends
*Preserving Policy Through Narrative Transformation* (Overstreet, forthcoming) from tithing
discourse to government communication.

This branch shares no files with the website on `main`, and it contains no GitHub Actions
workflows.

Interactive dashboard: https://claude.ai/artifact/QL6GppsoFQLRmuDqbNHT15 (private until shared).

## What is here

| Path | Contents |
|---|---|
| `govcomm/CODEBOOK.md` | Dimensions, anchor texts at −1/0/+1, categorical codes, pipeline summary |
| `govcomm/data/scored_posts.csv.gz` / `.parquet` | 144,600 posts with all scores, party slant, villain, topic, metadata and text |
| `govcomm/labels/teacher_labels.csv` | 1,400 blind teacher labels by Claude (join to `label_sample_key.csv` on `lid`) |
| `govcomm/labels/retest_*` | 80-post same-session retest (see the caveat below) |
| `govcomm/validation/` | 120-post human coding packet, key and scoring script |
| `govcomm/data/derived/` | Cross-validation output, confusion matrices, Congress slant model and report |
| `govcomm/analysis/tables/` | Every table behind the findings (CSV) |
| `govcomm/analysis/dashboard/` | The JSON tables the dashboard reads |
| `govcomm/pipeline/` | All code, in run order (see Reproduce) |

`analysis_sample` marks the posts used in every analysis: no reposts, and four or more words
once links are removed (all WhiteHouse.gov items are kept).

## Sources (all public GitHub archives)

| Voice | Archive | Coverage |
|---|---|---|
| @realDonaldTrump (Twitter) | MarkHershey/CompleteTrumpTweetsArchive | May 2009 – Jan 8, 2021, including deleted tweets |
| @realDonaldTrump (Truth Social) | stiles/trump-truth-social-archive | Feb 2022 – Oct 2025, with a few posts from Apr–May 2026 (gap Nov 2025 – Mar 2026) |
| @StateDept | lockdown-systems/statedept-archive | Jan 2008 – Jan 20, 2025 (dense from May 2012) |
| WhiteHouse.gov | Transparency47/WhiteHouse | Jan 20, 2025 – Oct 29, 2026 (actions, briefings, fact sheets, releases, research) |
| @POTUS, @WhiteHouse, @VP and staff accounts | bpb27/political_twitter_archive | Jan 20 – Mar 1, 2017 |
| Congress (benchmark only) | alexlitel/congresstweets, unitedstates/congress-legislators | Every 14th day, Jun 2017 – Jul 2023 |

## Measurement

1. **Teacher labels.** Claude coded a stratified sample of 1,400 non-repost posts on six
   continuous dimensions (−1 to +1) plus a villain and a topic. Text was shown blind to account,
   date and engagement, and shuffled across sources.
2. **Student models.** For each dimension, a ridge regression on word and character TF-IDF plus
   dense features, and a gradient-boosted model on GloVe-Twitter means, VADER sentiment, style
   features and TF-IDF SVD components. The two are averaged. Five-fold cross-validated agreement
   with the teacher:

   | Dimension | r | ρ |
   |---|---|---|
   | Ideology | 0.77 | 0.78 |
   | Professionalism | 0.91 | 0.91 |
   | Partisanship | 0.84 | 0.85 |
   | Threat/hope | 0.79 | 0.78 |
   | Personalization | 0.84 | 0.82 |
   | Function | 0.88 | 0.88 |

   The villain code reaches 75% accuracy (majority baseline 62%, macro-F1 0.39) and the topic code
   61% (baseline 24%, macro-F1 0.51). Treat both as exploratory.
3. **Independent ideology benchmark.** A logistic regression trained only on 124,108 tweets by
   394 members of Congress, labeled by party. Politicians' names, state names and district tags
   are masked so the model learns policy language, not who is mentioned. Held-out-member AUC is
   0.855 per tweet and 0.998 per member. It scores every post as `party_slant` = 2·P(Republican) − 1.
   Agreement with the Claude ideology score is modest per post (r 0.11–0.26 within accounts) and
   strong for account-quarter means (r = 0.65). On long formal documents such as nomination lists
   the slant is unreliable.
4. **Reliability.** A same-session retest of 80 posts agreed at r ≥ 0.997. Earlier labels were
   still in context, so this measures consistency, not independent reliability. The human packet
   in `govcomm/validation/` is the real test: two coders fill `human_coding_sheet.csv` using
   `CODEBOOK_for_coders.md`, then run
   `python3 -I govcomm/pipeline/make_validation_packet.py score govcomm/labels govcomm/validation coder1.csv coder2.csv`.

### Dimensionality

In the teacher labels, professionalism, partisanship, personalization and function load on one
factor (first eigenvalue 4.07 of 6, 68% of variance; the second is 0.97, mostly threat/hope). The
analysis therefore leads with an **institutional norms index**, the mean of those four, and keeps
threat/hope and ideology separate. Within the corpus, ideology and partisanship also correlate
strongly (r ≈ −0.8), because nearly all overtly partisan content is right-coded Trump content.
Read ideology with the party-slant benchmark beside it.

## Main findings

- **The President's own voice sits far below the institutions around him.** Mean norms index:
  Trump on Twitter as President −0.22; Trump on Truth Social as President −0.28; @StateDept +0.53;
  WhiteHouse.gov +0.24.
- **Holding office did not make Trump's posts more conventional.** On Twitter, comparing June
  2015 – Jan 2017 with 2017–2021 and holding topic fixed, the presidency moved professionalism by
  −0.085 (SE 0.010), partisanship by −0.085, and threat/hope by −0.077. Only personalization rose
  (+0.080), as posts shifted from his businesses to policy. On Truth Social, his 2025 posts were
  modestly more professional than his 2022–24 posts (+0.034, SE 0.015) and less partisan (+0.044).
- **The State Department's register ratcheted.** Its information-and-service score fell from 0.39
  (Clinton) and 0.38 (Kerry) to 0.35 (Tillerson), 0.23 (Pompeo) and 0.19 (Blinken). The norms
  index dropped from 0.57 under Kerry and Tillerson to 0.48 under Pompeo, and stayed at 0.48 under
  Blinken. Meanwhile the party-language slant swung from +0.28 (Pompeo) to −0.16 (Blinken). The
  interrupted time series shows significant per-year slope declines in function (−0.10/yr),
  partisanship (−0.05/yr) and personalization (−0.04/yr) during 2017–2020, and an immediate
  −0.50 level shift in party slant at the 2021 transition. A shift-share decomposition puts
  essentially all of the Kerry→Pompeo change *within* topics, not in topic mix. The department
  changed how it talks, not what it talks about. This is the same ratchet the tithing paper found:
  a shift that is not undone when leadership changes.
- **Villains.** Domestic political opponents are the main antagonist in Trump's posts (40% of
  his out-of-office Truth Social posts, 22% once back in office, 31% on Twitter as President).
  @StateDept's villains are foreign (21% of posts). WhiteHouse.gov in 2025–26 names foreign
  actors (20%), political opponents (9%) and the federal bureaucracy itself (9%).
- **The audience rewards norm-breaking.** On Truth Social, median likes fall from 19,984 for the
  least professional fifth of posts to 12,720 for the most professional fifth. Within a month and
  holding length fixed, each half-point toward professional predicts 16% fewer likes. This is
  the Narrative Policy Framework's individual-level feedback loop. It is correlational.
- **WhiteHouse.gov is two outlets.** Executive Orders (+0.41), Memoranda (+0.47) and Proclamations
  (+0.43) keep institutional form; Releases (−0.01) and Fact Sheets (+0.19) read like campaign
  material. Releases score highest on party slant (+0.40).

## Reproduce

```
# public archives cloned under /home/user/<owner>/<repo> (see Sources)
python3 -I govcomm/pipeline/build_corpus.py /home/user govcomm/data/corpus.parquet
python3 -I govcomm/pipeline/congress_slant.py <congresstweets/data> <congress-legislators> govcomm/data/corpus.parquet govcomm/data/derived
python3 -I govcomm/pipeline/make_label_sample.py govcomm/data/corpus.parquet govcomm/labels   # only for a new sample
python3 -I govcomm/pipeline/student.py govcomm/data/corpus.parquet govcomm/labels glove-twitter-100.gz govcomm/data/derived
python3 -I govcomm/pipeline/assemble.py govcomm/data
python3 -I govcomm/pipeline/analysis.py govcomm/data govcomm/labels govcomm/analysis
python3 -I govcomm/pipeline/dashboard_data.py govcomm/data govcomm/labels govcomm/analysis
```

GloVe-Twitter-100 comes from the gensim-data GitHub release. Python packages: pandas, pyarrow,
scikit-learn, scipy, statsmodels, vaderSentiment, ftfy, pyyaml, joblib. `student.py` refits
TF-IDF on whatever corpus it is given, so new sources are scored by re-running it after
`build_corpus.py`.

## Gaps, and what would fill them

The build session's network allowed only GitHub and PyPI. These sources would complete the
original scope (2000 to the present, more agencies):

| Need | Source | Host to allow |
|---|---|---|
| Every presidential statement, proclamation and set of remarks, 2000–now | Compilation of Presidential Documents (WCPD 2000–09, DCPD 2009–) | `www.govinfo.gov`, `api.govinfo.gov` |
| Obama, Trump-45 and Biden institutional accounts (@POTUS44, @WhiteHouse45, @POTUS46Archive …) | NARA presidential library social media exports | `obamalibrary.gov`, `www.trumplibrary.gov`, `www.bidenlibrary.gov`, `www.archives.gov`, `archive.org` |
| American Presidency Project tweet and document collections | UCSB | `www.presidency.ucsb.edu` |
| DHS, ICE, CBP, DoD, DOJ, HHS and other agency X accounts, and 2025–26 @WhiteHouse/@StateDept | X API (paid), twitterapi.io, Internet Archive captures | `api.x.com` or `api.twitterapi.io`, `web.archive.org` |
| Truth Social after Oct 2025 | CNN's live mirror of the same archive | `ix.cnn.io` |
| DW-NOMINATE scores for a continuous ideology benchmark | Voteview | `voteview.com` |
