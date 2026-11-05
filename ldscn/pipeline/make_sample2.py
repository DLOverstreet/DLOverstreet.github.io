"""Round-2 teacher sample, chosen on round-1 student scores to add coded examples of the rare stances.
Per era: the 9 unlabeled passages with the highest P(agree), the 7 with the highest P(disagree) and
4 with the highest P(any), deduplicated (120 passages). Used for training only, never for calibration.

Usage: python3 -I make_sample2.py <cn_scores.parquet> <chunks.parquet> <labels_dir>
"""
import sys

import pandas as pd

scores, src, out = sys.argv[1:4]
sc = pd.read_parquet(scores)
done = set(pd.read_csv(f"{out}/cn_sample_key.csv").chunk_id)
sc = sc[~sc.chunk_id.isin(done)]
picks = []
for era, g in sc.groupby("era"):
    chosen = []
    for col, k in (("raw_agree", 9), ("raw_disagree", 7), ("raw_any", 4)):
        cand = g[~g.chunk_id.isin(chosen)].nlargest(k, col)
        chosen += list(cand.chunk_id)
    picks.append(g[g.chunk_id.isin(chosen)].assign(stratum=era))
s = pd.concat(picks).sample(frac=1, random_state=11).reset_index(drop=True)
s["lid"] = [f"D{i:04d}" for i in range(1, len(s) + 1)]
txt = pd.read_parquet(src, columns=["chunk_id", "text"])
s = s.merge(txt, on="chunk_id")
s[["lid", "chunk_id", "talk_id", "stratum", "year", "speaker"]].to_csv(f"{out}/cn_sample2_key.csv", index=False)
s[["lid", "text"]].to_json(f"{out}/cn_sample2_text.jsonl", orient="records", lines=True, force_ascii=False)
print(len(s), s.stratum.value_counts().to_dict())
