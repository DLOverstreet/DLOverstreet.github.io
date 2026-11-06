# Rhetoric around policy breaks in LDS general-authority discourse

A follow-up to the tithing-rhetoric paper. It studies two dated policy breaks:
- the June 1978 revelation ending the priesthood and temple restriction (Official Declaration 2);
- the April 2018 move from home and visiting teaching to ministering.

Treated topics are compared with control topics (tithing, Word of Wisdom, Sabbath, prayer and scripture study, welfare,
chastity) using difference-in-differences, event studies, a break-date scan, synthetic control, placebos, and
within-speaker and by-rank estimates.

- `PAPER_BREAKS.md`: paper draft with all results, tables and figures.
- `CODEBOOK_BREAK.md`: the four rhetoric dimensions and the content flags.
- `pipeline/`: rank table, topic dictionaries, sample, student model, analysis, robustness and figures. The run order is
  in the paper's appendix.
- `labels/`: teacher codes (`break_labels.csv`) and the sample key with strata sizes. Passage text is not committed.
- `out/`: every aggregate result as CSV, plus the full printed logs.
- `figs/`: figures. Nineteenth-century and modern data are always on separate axes.

The corpus and feature cache come from `ldscn/` (built by `ldscn/pipeline/build_corpus.py` and `cn_student.py`).
