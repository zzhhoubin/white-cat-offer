import json
import os
import sys

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")
import fitz
from resume_parser import (
    clean_resume_text,
    extract_deterministic_resume,
    extract_text,
    structured_resume_plain_text,
)
from resume_schema import normalize_structured

refs = r"d:\white_cat\references"
parsed2 = next(f for f in os.listdir(refs) if f.endswith("2.pdf"))
source = next(
    f
    for f in os.listdir(refs)
    if f.endswith(".pdf") and "resume-grower" not in f and not f.startswith("AI") and len(f) > 6
)

# extract parsed2 visual text
doc = fitz.open(os.path.join(refs, parsed2))
parts = []
for i, page in enumerate(doc, 1):
    t = page.get_text().strip()
    if t:
        parts.append(f"--- 第{i}页 ---\n{t}")
open(r"d:\white_cat\prototypes\_compare_parsed2.txt", "w", encoding="utf-8").write(
    f"FILE: {parsed2}\n\n" + "\n\n".join(parts)
)

# current pipeline deterministic
path = os.path.join(refs, source)
cleaned, raw = clean_resume_text(extract_text(path))
det = normalize_structured(extract_deterministic_resume(cleaned))
plain = structured_resume_plain_text(det)
open(r"d:\white_cat\prototypes\_pipeline_plain.txt", "w", encoding="utf-8").write(plain)
open(r"d:\white_cat\prototypes\_pipeline_struct.json", "w", encoding="utf-8").write(
    json.dumps(det, ensure_ascii=False, indent=2)
)
open(r"d:\white_cat\prototypes\_pipeline_cleaned.txt", "w", encoding="utf-8").write(cleaned)
print("parsed2", parsed2, "chars", sum(len(p) for p in parts))
print("source", source)
print("cleaned", len(cleaned), "plain", len(plain))
print("exp", len(det["experience"]), "proj", len(det["projects"]), "edu", len(det["education"]))
