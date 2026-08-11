# 书写质量评分报告 JSON Schema

模型必须返回**单个 JSON 对象**，字段如下。

```json
{
  "total": 78,
  "base": 76,
  "bonus": 5,
  "penalty": 3,
  "grade": "良好",
  "grade_key": "strong",
  "dimensions": {
    "structure": {
      "score": 12,
      "max": 15,
      "level": "良好",
      "evidence": ["证据1", "证据2"],
      "suggestions": ["建议1"]
    },
    "completeness": { "score": 12, "max": 15, "level": "良好", "evidence": [], "suggestions": [] },
    "expression": { "score": 14, "max": 20, "level": "良好", "evidence": [], "suggestions": [] },
    "quantification": { "score": 10, "max": 20, "level": "合格", "evidence": [], "suggestions": [] },
    "credibility": { "score": 13, "max": 15, "level": "良好", "evidence": [], "suggestions": [] },
    "differentiation": { "score": 12, "max": 15, "level": "良好", "evidence": [], "suggestions": [] }
  },
  "bonus_items": [{ "name": "技术博客", "points": 2, "evidence": "…" }],
  "penalty_items": [{ "name": "弱动词过多", "points": 1, "evidence": "…" }],
  "top_strengths": ["优势1", "优势2", "优势3"],
  "top_improvements": [
    {
      "title": "量化缺失",
      "impact": "高",
      "before": "原文摘录",
      "after": "建议改写",
      "detail": "说明"
    }
  ],
  "action_items": ["可执行修改建议1", "建议2"],
  "summary": "一句话诊断",
  "radar": [12, 12, 14, 10, 13, 12]
}
```

## 字段约束

- `dimensions` 六键固定：`structure`, `completeness`, `expression`, `quantification`, `credibility`, `differentiation`
- 各维 `max` 固定为 15/15/20/20/15/15；`score` 为 0–max 整数
- `radar` 顺序与上列六键一致，值为各维 `score`
- `bonus` / `penalty` 为非负整数，分别 ≤10；`bonus_items`/`penalty_items` 的 points 之和应与之接近
- `base` 应为六维 score 之和；`total` = clamp(base+bonus-penalty, 0, 110)
- `top_strengths` 最多 3 条；`top_improvements` **至少 10 条、最多 25 条**，按影响优先级排序（高→中→低）
- `impact` 取值：`高` / `中` / `低`
- 每条 `top_improvements` 尽量含 `title`、`impact`、`before`（原文摘录）、`after`（改写建议）、`detail`（说明）
- `grade` 中文：优秀/良好/合格/待改进/不合格
- 不要输出岗位匹配分字段
