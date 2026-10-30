"""Build a 120-post human coding packet from the teacher-labeled sample, and score it once coded.

Build:  python3 -I make_validation_packet.py build <labels_dir> <out_dir>
Score:  python3 -I make_validation_packet.py score <labels_dir> <out_dir> <coded_sheet.csv> [<second_coder.csv>]
"""
import json
import os
import sys

import numpy as np
import pandas as pd

DIMS = ["ideology", "professionalism", "partisanship", "threat_hope", "personalization", "function"]
mode, labels_dir, out = sys.argv[1:4]
key = pd.read_csv(os.path.join(labels_dir, "label_sample_key.csv"))

if mode == "build":
    texts = pd.read_json(os.path.join(labels_dir, "label_sample_text.jsonl"), lines=True)
    df = texts.merge(key, on="lid")
    # 25 per main account group, 20 from the small 2017 accounts, so every voice is represented.
    df["grp"] = df.account.where(df.account.isin(["@StateDept", "WhiteHouse.gov", "@realDonaldTrump", "@realDonaldTrump (Truth Social)"]), "other")
    pick = df.groupby("grp", group_keys=False).apply(lambda g: g.sample(min(len(g), 25 if g.name != "other" else 20), random_state=11))
    pick = pick.sample(frac=1, random_state=12).reset_index(drop=True)
    pick["hid"] = [f"H{i:03d}" for i in range(1, len(pick) + 1)]
    sheet = pick[["hid", "display"]].rename(columns={"display": "text"})
    for d in DIMS:
        sheet[d] = ""
    sheet["villain"] = ""
    sheet["topic"] = ""
    sheet.to_csv(os.path.join(out, "human_coding_sheet.csv"), index=False)
    pick[["hid", "lid", "post_id"]].to_csv(os.path.join(out, "human_coding_key.csv"), index=False)
    print(f"wrote {len(sheet)} posts")
else:
    k = pd.read_csv(os.path.join(out, "human_coding_key.csv"))
    teacher = pd.read_csv(os.path.join(labels_dir, "teacher_labels.csv"))
    oof = pd.read_csv(os.path.join(os.path.dirname(labels_dir), "data", "derived", "oof_predictions.csv"))
    coders = [pd.read_csv(p) for p in sys.argv[4:]]
    m = k.merge(teacher, on="lid").merge(oof[["lid"] + [d + "_oof" for d in DIMS]], on="lid")
    rows = []
    for d in DIMS:
        h = np.mean([c.set_index("hid").loc[m.hid, d].astype(float).values for c in coders], axis=0)
        r = {"dimension": d, "human_vs_claude_r": np.corrcoef(h, m[d])[0, 1], "human_vs_student_r": np.corrcoef(h, m[d + "_oof"])[0, 1]}
        if len(coders) == 2:
            a, b = (c.set_index("hid").loc[m.hid, d].astype(float).values for c in coders)
            r["coder1_vs_coder2_r"] = np.corrcoef(a, b)[0, 1]
        rows.append(r)
    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(out, "human_validation_results.csv"), index=False)
    print(res.round(3).to_string(index=False))
