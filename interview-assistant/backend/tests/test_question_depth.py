import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from question_depth import (
    interview_db_path,
    job_hits_sys,
    list_featured,
    list_sys_questions,
    merge_depth_answers,
    split_depth_md,
    studio_fingerprint,
)

SAMPLE = """
### 题目信息
- **题目**：测试题

### 1. 基础标准答案
这是标准答案。

### 2. 结构化口述框架（60-90秒版）
**定基调**
先定调。

**核心拆解**
再拆解。

**落地实践**
再落地。

**总结收尾**
最后收口。

### 3. 深度解析
深度正文。

### 4. 常见避坑与“减分项”警告
1. **【Critical】别把 RAG 当成向量检索**

### 5. 加分表达
- **工程化视角**：提到 Rerank。

### 6. 题目变体树
原题
├── 简化版：一句话讲 RAG

### 7. 面试官追问（1-6个）
1. **追问**：为什么切分要 overlap？
   - **考察意图**：看你是否理解边界截断。
   - **回答要点**：语义连续，常用 10%-15% 重叠。
2. **追问**：短 query 怎么召回长文档？
   - **考察意图**：Query 改写。
   - **回答要点**：补全实体后再检索。

### 8. 深度扩展
- **相关核心概念**
混合检索。
- **真实业务案例**
HR 助手误召回。
- **权衡与取舍**
召回率 vs 精确率。
- **进一步学习建议**
读 RAG 评测。
"""


def test_split_five_tabs():
    tabs = split_depth_md(SAMPLE)
    assert tabs is not None
    assert "标准答案" in tabs["reference"]["standard_answer"]
    steps = [x["step"] for x in tabs["reference"]["oral_framework"]]
    assert steps[:4] == ["定基调", "核心拆解", "落地实践", "总结收尾"]
    assert "深度正文" in tabs["depth"]["deep_dive"]
    assert "向量检索" in tabs["depth"]["pitfalls_md"]
    assert "简化版" in tabs["variants"]["tree_md"]
    assert len(tabs["followups"]) == 2
    assert "overlap" in tabs["followups"][0]["question"]
    assert "混合检索" in tabs["extend"]["concepts"]


def test_no_mark_returns_none():
    assert split_depth_md("一段普通回答") is None


def test_job_hits_sys():
    assert job_hits_sys("互联网 / AI‑IT 技术", "AI 算法方向", "大模型算法")
    assert job_hits_sys("", "", "AI 产品")
    assert not job_hits_sys("互联网 / AI‑IT 技术", "前端 & 移动端", "前端工程师")


def test_merge_keeps_depth_answer():
    old = [
        type("Q", (), {"question": "RAG 是什么？", "answer": SAMPLE, "question_id": "keep-me"})()
    ]
    new_items = [{"question": "RAG是什么？", "answer": "短答"}]
    merged = merge_depth_answers(old, new_items)
    assert merged[0]["question_id"] == "keep-me"
    assert "### 1. 基础标准答案" in merged[0]["answer"]


def test_studio_fingerprint_stable():
    a = studio_fingerprint("AI > 大模型算法", "简历A")
    b = studio_fingerprint("AI > 大模型算法", "简历A")
    c = studio_fingerprint("AI > 大模型算法", "简历B")
    assert a == b
    assert a != c
    assert studio_fingerprint("AI > 大模型算法", "简历A") == studio_fingerprint(
        "AI > 大模型算法", "简历A", ""
    )
    assert studio_fingerprint("r", "简历A", "材料1") != studio_fingerprint("r", "简历A", "材料2")


def test_list_sys_from_interview_db():
    if not interview_db_path().is_file():
        return
    miss = list_sys_questions(job_l1="", job_l2="前端 & 移动端", job_l3="前端工程师")
    assert miss["match"] == "miss"
    assert miss["questions"] == []
    hit = list_sys_questions(job_l1="", job_l2="AI 算法方向", job_l3="大模型算法")
    assert hit["match"] == "exact"
    assert len(hit["questions"]) == 10
    first = hit["questions"][0]
    assert first["tabs"]
    assert first["tabs"]["reference"]["oral_framework"]
    assert "RAG" in first["question"] or first["question"]


def test_list_featured_by_direction():
    if not interview_db_path().is_file():
        return
    miss = list_featured(l1="前端", l2="前端基础")
    assert miss["match"] == "miss"
    assert miss["questions"] == []
    other = list_featured(l1="人工智能", l2="AI算法与模型研发")
    assert other["questions"] == []
    assert all(q.get("direction") != "AI应用开发与Agent" for q in other["questions"])
    hit = list_featured(l1="人工智能", l2="AI应用开发与Agent")
    assert hit["match"] == "exact"
    assert len(hit["questions"]) == 10
    assert hit["questions"][0]["tabs"]
    assert all(q["direction"] == "AI应用开发与Agent" for q in hit["questions"])

