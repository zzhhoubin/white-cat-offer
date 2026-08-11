import os
import sys
import tempfile

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")

refs = r"d:\white_cat\references"
src = next(
    f
    for f in os.listdir(refs)
    if f.endswith(".pdf") and not f.startswith("AI") and "resume-grower" not in f and len(f) > 6
)
path = os.path.join(refs, src)
print("PDF", src)

# pdfmux
import pdfmux

text = pdfmux.extract_text(path)
if not isinstance(text, str):
    text = getattr(text, "text", None) or str(text)
open(r"d:\white_cat\prototypes\_pdfmux_raw.txt", "w", encoding="utf-8").write(text[:8000])
print("pdfmux type", type(text), "len", len(text))

# try extract_json briefly
try:
    js = pdfmux.extract_json(path)
    open(r"d:\white_cat\prototypes\_pdfmux_meta.txt", "w", encoding="utf-8").write(repr(type(js)) + "\n" + str(js)[:500])
except Exception as e:
    open(r"d:\white_cat\prototypes\_pdfmux_meta.txt", "w", encoding="utf-8").write("json fail " + str(e))

# compare with existing pipeline scoring
from resume_parser import (
    _extract_pdf_pymupdf,
    _score_extraction,
    clean_resume_text,
    extract_deterministic_resume,
)

for name, t in [("pdfmux", text), ("blocks", _extract_pdf_pymupdf(path))]:
    print(name, "score", round(_score_extraction(t), 1), "len", len(t))

c, _ = clean_resume_text(text)
det = extract_deterministic_resume(c)
open(r"d:\white_cat\prototypes\_pdfmux_det.txt", "w", encoding="utf-8").write(
    f"exp={len(det['experience'])} proj={len(det['projects'])}\n"
    + "\n".join(f"{p['name']}|{p['role']}|intro={ (p.get('intro') or '')[:40]}" for p in det["projects"])
)
print("det", len(det["experience"]), len(det["projects"]))
