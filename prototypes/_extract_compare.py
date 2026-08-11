import os
import sys

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")
import fitz

refs = r"d:\white_cat\references"
files = os.listdir(refs)
parsed = next(
    f for f in files if f.endswith(".pdf") and f not in (
        "resume-grower-skill.pdf",
    ) and not f.startswith("AI") and not f.startswith("\u5e72") and len(f) < 12
)
source = next(
    f for f in files
    if f.endswith(".pdf") and f != parsed and "resume-grower" not in f and not f.startswith("AI")
)

for label, name in [("PARSED", parsed), ("SOURCE", source)]:
    path = os.path.join(refs, name)
    doc = fitz.open(path)
    parts = []
    for i, page in enumerate(doc, 1):
        t = page.get_text().strip()
        if t:
            parts.append(f"--- 第{i}页 ---\n{t}")
    out = "\n\n".join(parts)
    dest = os.path.join(r"d:\white_cat\prototypes", f"_compare_{label.lower()}.txt")
    open(dest, "w", encoding="utf-8").write(f"FILE: {name}\n\n{out}")
    print(label, name, "pages", doc.page_count, "chars", len(out), "->", dest)
