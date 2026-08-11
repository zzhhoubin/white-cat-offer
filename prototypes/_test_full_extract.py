import json
import os
import sys

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")
from resume_parser import clean_resume_text, extract_structured_resume, extract_text, structured_resume_plain_text

refs = r"d:\white_cat\references"
source = next(
    f
    for f in os.listdir(refs)
    if f.endswith(".pdf") and not f.startswith("AI") and "resume-grower" not in f and len(f) > 6
)
cleaned, _ = clean_resume_text(extract_text(os.path.join(refs, source)))
structured = extract_structured_resume(cleaned)
plain = structured_resume_plain_text(structured)
open(r"d:\white_cat\prototypes\_full_structured.json", "w", encoding="utf-8").write(
    json.dumps(structured, ensure_ascii=False, indent=2)
)
open(r"d:\white_cat\prototypes\_full_plain.txt", "w", encoding="utf-8").write(plain)

exp = structured["experience"]
proj = structured["projects"]
assert structured["extras"].get("extraction") == "deterministic", structured["extras"]
assert len(exp) == 2 and all(e["bullets"] for e in exp), exp
assert len(proj) == 4, proj
suo = next(p for p in proj if "锁客" in p["name"])
assert "10%+" in "\n".join(suo["responsibilities"])
assert not any("变现方式" in b for e in exp for b in e["bullets"])
biz = next(p for p in proj if "商业产品" in p["name"])
assert "客户规模" in "\n".join(biz["responsibilities"])
pick = next(p for p in proj if "精选" in p["name"])
assert "cpc" in pick["intro"]
assert "10%+" in "\n".join(pick["achievements"])
open(r"d:\white_cat\prototypes\_full_test_ok.txt", "w", encoding="utf-8").write("OK\n")
