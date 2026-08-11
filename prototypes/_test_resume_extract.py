"""回归：猎聘 PDF 多引擎抽取 + 项目切窗（不调 LLM）。"""
import json
import os
import sys

sys.path.insert(0, r"d:\white_cat\interview-assistant\backend")

from resume_parser import (  # noqa: E402
    clean_resume_text,
    extract_text,
    split_project_windows,
)

refs = r"d:\white_cat\references"
path = None
for f in os.listdir(refs):
    if f.endswith(".pdf") and "resume-grower" not in f and "AI" not in f and "面试" not in f:
        path = os.path.join(refs, f)
        break

print("PDF:", path)
text = extract_text(path)
cleaned, raw = clean_resume_text(text)
print("LEN", len(raw), len(cleaned))
print("--- snippet around 项目经历 ---")
i = cleaned.find("项目经历")
print(cleaned[i : i + 1200])
print("--- projects ---")
projects = split_project_windows(cleaned)
for p in projects:
    print(
        json.dumps(
            {
                "name": p["name"],
                "role": p["role"],
                "company": p["company"],
                "start": p["start"],
                "end": p["end"],
                "intro": (p["intro"] or "")[:60],
                "resp_n": len(p["responsibilities"]),
                "ach_n": len(p["achievements"]),
                "resp0": (p["responsibilities"][0][:50] if p["responsibilities"] else ""),
                "ach0": (p["achievements"][0][:50] if p["achievements"] else ""),
            },
            ensure_ascii=False,
        )
    )

# 关键串段检查
assert len(projects) >= 3, projects
suo = next(p for p in projects if "锁客" in p["name"])
assert "20年重点" in suo["intro"] or "公域" in suo["intro"], suo
assert "促活" in suo["intro"] or "私域" in suo["intro"], suo["intro"]
assert any("10%+" in x or "日活" in x for x in suo["responsibilities"]), suo
assert not any("用户端" in x for x in suo["responsibilities"]), suo
assert not any(x.startswith("同时提供") for x in suo["responsibilities"]), suo
life = next(p for p in projects if "生命" in p["name"])
assert "进销存" in life["intro"] or "研究推动" in life["intro"], life
assert any("过期率" in x or "3W" in x for x in life["achievements"]), life
biz = next(p for p in projects if "商业产品" in p["name"])
assert biz["company"] == "58同城", biz
assert "分析框架" in biz["intro"] or "方法论" in biz["intro"], biz
assert any("客户规模" in x for x in biz["responsibilities"]), biz
pick = next(p for p in projects if "精选" in p["name"])
assert "cpc" in pick["intro"] or "变现" in pick["intro"], pick
assert any("10%+" in x for x in pick["achievements"]), pick
# 工作经历内容不应在锁客宝
work_leak = "用户端的流量"
assert work_leak not in suo["intro"]
assert all(work_leak not in x for x in suo["responsibilities"])
assert work_leak in cleaned
print("OK")
