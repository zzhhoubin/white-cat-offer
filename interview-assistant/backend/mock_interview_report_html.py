"""Generate standalone HTML reports for mock interview sessions."""

from __future__ import annotations

import html
from datetime import datetime


def build_html_report(session: dict, report: dict, answers: list[dict]) -> str:
    role = html.escape(session.get("role") or "目标岗位")
    company = html.escape(session.get("company_name") or "目标公司")
    session_id = html.escape(session.get("session_id") or "")
    total = int(report.get("total_score") or 0)
    recommendation = html.escape(report.get("recommendation") or "")
    summary = html.escape(report.get("summary") or "")
    date_str = datetime.now().strftime("%Y年%m月%d日")

    dimensions_html = "".join(_dimension_card(dim) for dim in report.get("dimensions") or [])
    rounds_html = "".join(_round_section(rnd) for rnd in report.get("rounds") or [])
    if not rounds_html:
        rounds_html = _fallback_rounds(answers)
    catalog = report.get("question_catalog") or _fallback_catalog(answers)
    questions_html = "".join(
        f"<tr><td>{entry.get('index', idx)}</td>"
        f"<td>{html.escape(entry.get('question', ''))}</td>"
        f"<td>{html.escape(entry.get('intent') or '')}</td></tr>"
        for idx, entry in enumerate(catalog, start=1)
    )
    actions_html = _action_plan_html(report.get("action_plan") or {})

    ring = _score_ring(total)
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>模拟面试报告 — {role}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
<style>
:root {{
  --ink:#1a1f2e; --ink-light:#4a5568; --ink-muted:#718096;
  --accent:#2d6b5f; --accent-light:#e8f4f0; --blue:#3b82f6;
  --red:#ef4444; --green:#22c55e; --orange:#f59e0b;
  --bg:#f8f9fa; --card:#ffffff; --border:#e5e7eb;
}}
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Noto Sans SC',sans-serif;background:var(--bg);color:var(--ink);line-height:1.7;padding:24px 0 60px}}
.container{{max-width:860px;margin:0 auto;padding:0 20px}}
.header{{background:linear-gradient(135deg,#1a1f2e 0%,#2d3748 100%);border-radius:16px 16px 0 0;padding:48px;color:#fff}}
.header-badge{{display:inline-block;background:rgba(255,255,255,.15);font-size:13px;padding:4px 14px;border-radius:20px;margin-bottom:20px}}
.header h1{{font-family:'Noto Serif SC',serif;font-size:28px;margin-bottom:8px}}
.header-subtitle{{font-size:15px;color:rgba(255,255,255,.7);margin-bottom:24px}}
.header-meta{{display:flex;gap:24px;flex-wrap:wrap;font-size:14px;color:rgba(255,255,255,.6)}}
.main-card{{background:var(--card);border-radius:0 0 16px 16px;box-shadow:0 4px 16px rgba(0,0,0,.04);overflow:hidden}}
.section{{padding:40px 48px;border-bottom:1px solid var(--border)}}
.section:last-child{{border-bottom:none}}
.section-title{{font-family:'Noto Serif SC',serif;font-size:20px;padding-left:16px;border-left:4px solid var(--accent);margin-bottom:28px}}
.score-hero{{display:flex;align-items:center;gap:48px;flex-wrap:wrap}}
.score-ring-wrap{{position:relative;width:180px;height:180px;flex-shrink:0}}
.score-ring-wrap svg{{transform:rotate(-90deg)}}
.score-ring-number{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}}
.score-ring-number .big{{font-size:52px;font-weight:700;font-family:'Noto Serif SC',serif;line-height:1}}
.score-ring-number .small{{font-size:14px;color:var(--ink-muted)}}
.grade-badge{{display:inline-block;font-size:14px;font-weight:600;padding:5px 16px;border-radius:6px;margin-bottom:12px;background:var(--accent-light);color:var(--accent)}}
.score-summary{{font-size:15px;color:var(--ink-light)}}
.dim-grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}
.dim-card{{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:24px}}
.dim-card-header{{display:flex;justify-content:space-between;margin-bottom:12px}}
.dim-card-score{{font-size:32px;font-weight:700;font-family:'Noto Serif SC',serif}}
.progress-bar{{height:8px;border-radius:4px;background:#e5e7eb;margin-bottom:12px;overflow:hidden}}
.progress-fill{{height:100%;border-radius:4px}}
.progress-fill.green{{background:linear-gradient(90deg,var(--green),#16a34a)}}
.progress-fill.orange{{background:linear-gradient(90deg,var(--orange),#d97706)}}
.progress-fill.red{{background:linear-gradient(90deg,var(--red),#dc2626)}}
.round-card{{border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px;background:var(--bg)}}
.round-card h3{{font-size:18px;margin-bottom:16px}}
.q-card{{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}}
.q-head{{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}}
.score-badge{{font-size:13px;font-weight:600;padding:4px 10px;border-radius:8px;white-space:nowrap}}
.score-badge.high{{background:#dcfce7;color:#166534}}
.score-badge.mid{{background:#fef3c7;color:#92400e}}
.score-badge.low{{background:#fee2e2;color:#991b1b}}
.sub-block{{border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:13px}}
.sub-block.good{{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}}
.sub-block.bad{{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}}
.sub-block.tip{{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}}
.ref-answer{{border-left:3px solid var(--accent);padding-left:16px;background:#f8fafc;border-radius:8px;padding:12px 16px;font-size:14px;color:var(--ink-light)}}
table{{width:100%;border-collapse:collapse;font-size:14px}}
th,td{{border:1px solid var(--border);padding:10px 12px;text-align:left}}
th{{background:var(--bg)}}
.action-group{{margin-bottom:20px}}
.action-group h4{{font-size:15px;margin-bottom:10px;color:var(--ink)}}
.action-list{{padding-left:20px}}
.action-list li{{margin-bottom:8px}}
@media (max-width:720px){{.section{{padding:28px 20px}}.dim-grid{{grid-template-columns:1fr}}}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="header-badge">AI 模拟面试报告</div>
    <h1>{role}</h1>
    <p class="header-subtitle">{company} · 会话 {session_id}</p>
    <div class="header-meta"><span>生成日期：{date_str}</span><span>题目数：{len(answers)}</span></div>
  </div>
  <div class="main-card">
    <section class="section">
      <h2 class="section-title">总评</h2>
      <div class="score-hero">
        {ring}
        <div class="score-info">
          <span class="grade-badge">{recommendation}</span>
          <p class="score-summary">{summary}</p>
        </div>
      </div>
    </section>
    <section class="section">
      <h2 class="section-title">能力维度评分</h2>
      <div class="dim-grid">{dimensions_html}</div>
    </section>
    <section class="section">
      <h2 class="section-title">逐轮详细反馈</h2>
      {rounds_html}
    </section>
    <section class="section">
      <h2 class="section-title">面试题目合集</h2>
      <table>
        <thead><tr><th>#</th><th>题目</th><th>核心考察点</th></tr></thead>
        <tbody>{questions_html}</tbody>
      </table>
    </section>
    <section class="section">
      <h2 class="section-title">备考行动清单</h2>
      {actions_html}
    </section>
  </div>
</div>
</body>
</html>"""


def _score_ring(score: int) -> str:
    radius = 80
    circumference = 2 * 3.14159 * radius
    offset = circumference * (1 - max(0, min(score, 100)) / 100)
    color = "#22c55e" if score >= 75 else "#f59e0b" if score >= 60 else "#ef4444"
    return f"""<div class="score-ring-wrap">
  <svg width="180" height="180" viewBox="0 0 180 180">
    <circle cx="90" cy="90" r="{radius}" fill="none" stroke="#e5e7eb" stroke-width="12"/>
    <circle cx="90" cy="90" r="{radius}" fill="none" stroke="{color}" stroke-width="12"
      stroke-dasharray="{circumference:.2f}" stroke-dashoffset="{offset:.2f}" stroke-linecap="round"/>
  </svg>
  <div class="score-ring-number">
    <span class="big">{score}</span>
    <span class="small">/ 100</span>
  </div>
</div>"""


def _progress_class(score: int) -> str:
    if score >= 80:
        return "green"
    if score >= 50:
        return "orange"
    return "red"


def _score_badge_class(score: int) -> str:
    if score >= 75:
        return "high"
    if score >= 60:
        return "mid"
    return "low"


def _dimension_card(dim: dict) -> str:
    name = html.escape(dim.get("name") or "")
    score = int(dim.get("score") or 0)
    comment = html.escape(dim.get("comment") or "")
    pclass = _progress_class(score)
    return f"""<div class="dim-card">
  <div class="dim-card-header"><span class="dim-card-name">{name}</span></div>
  <div class="dim-card-score">{score}<span style="font-size:14px;color:var(--ink-muted)"> / 100</span></div>
  <div class="progress-bar"><div class="progress-fill {pclass}" style="width:{score}%"></div></div>
  <p style="font-size:13px;color:var(--ink-light)">{comment}</p>
</div>"""


def _round_section(rnd: dict) -> str:
    label = html.escape(rnd.get("round_label") or "综合")
    score = int(rnd.get("score") or 0)
    items_html = "".join(_question_card(item) for item in rnd.get("items") or [])
    return f"""<div class="round-card">
  <h3>{label} · 该轮评分 {score} / 100</h3>
  {items_html}
</div>"""


def _question_card(item: dict) -> str:
    question = html.escape(item.get("question") or "")
    score = int(item.get("score") or 0)
    summary = html.escape(item.get("answer_summary") or item.get("answer_text") or "（未填写）")
    reference = html.escape(item.get("reference_answer") or "")
    strengths = "".join(
        f'<div class="sub-block good">✅ {html.escape(s)}</div>' for s in (item.get("strengths") or [])[:2]
    )
    weaknesses = "".join(
        f'<div class="sub-block bad">⚠️ {html.escape(s)}</div>' for s in (item.get("improvements") or [])[:2]
    )
    tips = "".join(
        f'<div class="sub-block tip">💡 {html.escape(s)}</div>' for s in (item.get("optimization_tips") or [])[:3]
    )
    badge = _score_badge_class(score)
    ref_block = f'<div class="ref-answer"><strong>📝 参考回答</strong><p>{reference}</p></div>' if reference else ""
    return f"""<div class="q-card">
  <div class="q-head"><strong>{question}</strong><span class="score-badge {badge}">{score} / 100</span></div>
  <p style="font-size:14px;color:var(--ink-light);margin-bottom:12px"><strong>你的回答：</strong>{summary}</p>
  {strengths}{weaknesses}{tips}{ref_block}
</div>"""


def _fallback_rounds(answers: list[dict]) -> str:
    avg = int(sum(float(a.get("score") or 0) for a in answers) / len(answers)) if answers else 0
    return _round_section({"round_label": "综合", "score": avg, "items": answers})


def _fallback_catalog(answers: list[dict]) -> list[dict]:
    return [
        {"index": idx, "question": item.get("question", ""), "intent": item.get("intent", "")}
        for idx, item in enumerate(answers, start=1)
    ]


def _action_plan_html(action_plan: dict) -> str:
    sections = [
        ("最需要加强的 Top 3 问题", action_plan.get("top_issues") or []),
        ("话术优化建议", action_plan.get("phrasing_tips") or []),
        ("推荐准备的材料", action_plan.get("materials") or []),
    ]
    html_parts = []
    for title, items in sections:
        if not items:
            continue
        lis = "".join(f"<li>{html.escape(item)}</li>" for item in items)
        html_parts.append(f'<div class="action-group"><h4>{html.escape(title)}</h4><ol class="action-list">{lis}</ol></div>')
    return "".join(html_parts) or "<p>暂无行动建议。</p>"
