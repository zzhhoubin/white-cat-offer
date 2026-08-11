import json
import os
import sys

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")
from resume_parser import (
    clean_resume_text,
    extract_deterministic_resume,
    extract_text,
    split_experience_windows,
    split_project_windows,
)

refs = r"d:\white_cat\references"
src = next(
    f
    for f in os.listdir(refs)
    if f.endswith(".pdf") and not f.startswith("AI") and "resume-grower" not in f and len(f) > 6
)
path = os.path.join(refs, src)
cleaned, _ = clean_resume_text(extract_text(path))
det = extract_deterministic_resume(cleaned)

open(r"d:\white_cat\prototypes\_deterministic.json", "w", encoding="utf-8").write(
    json.dumps(det, ensure_ascii=False, indent=2)
)

exp = det["experience"]
proj = det["projects"]
results = []
results.append(f"EXP {len(exp)}")
for e in exp:
    results.append(f"  {e['company']} | {e['title']} | bullets={len(e['bullets'])}")
results.append(f"PROJ {len(proj)}")
open(r"d:\white_cat\prototypes\_test_det_out.txt", "w", encoding="utf-8").write("\n".join(results))

# assertions
assert len(exp) == 2, exp
assert not any("客户规模" in b for e in exp for b in e["bullets"]), exp
assert any("用户端" in b for e in exp for b in e["bullets"]), exp
assert len(proj) == 4, proj
suo = next(p for p in proj if "锁客" in p["name"])
assert suo["role"] == "项目分析师"
assert "10%+" in "\n".join(suo["responsibilities"])
assert det["basics"]["name"]
assert len(det["education"]) >= 3
assert len(det["honors"]) >= 3
open(r"d:\white_cat\prototypes\_test_det_out.txt", "a", encoding="utf-8").write("\nOK\n")
