---
name: interview-depth-analysis
description: Generate bagujing-style deep interview question analysis. Use when user asks for in-depth analysis, structured oral framework, pitfalls, bonus points, variant tree, follow-up questions, or full depth breakdown of any technical interview question. Covers basic answer, oral framework, deep analysis, pitfalls, bonus expressions, variant tree, interviewer follow-ups and deep expansion.
---

# Interview Depth Analysis Skill

When the user provides an interview question (or asks to deeply analyze one), generate a complete structured analysis that strictly follows the bagujing.com depth style.

## Output Format (Mandatory)

Always output in the following Markdown structure. Do not omit any section. Use Chinese for all content unless the user explicitly requests English.

### 题目信息
- **题目**：{完整题目}

### 1. 基础标准答案
（简洁、正确、采用结构化表达的、可直接背诵的标准回答，150-300字）

### 2. 结构化口述框架（60-90秒版）
**定基调**  
...

**核心拆解**  
...

**落地实践**  
...

**总结收尾**  
...

### 3. 深度解析
（从背景知识、原理、实现、对比、边界、工程实践、常见误区多维度展开，400-800字）

### 4. 常见避坑与“减分项”警告
1. 列出1-5个高频踩坑点，按严重程度排序（critical/major/minor）
2. 每个坑点包含：错误描述 + 为什么面试官讨厌这个答案 + 正确做法


### 5. 加分表达
- **高级表达1**：具体话术 + 为什么加分
- **工程化视角**：...
- **架构级思考**：...

### 6. 题目变体树
原题
├── 简化版：...
├── 加深版：...
├── 场景化：...
├── 代码实现题：...
├── 经验追问：...
└── 对比题：...



### 7. 面试官追问（1-6个）
1. **追问**：...
   - **考察意图**：...
   - **回答要点**：...

### 8. 深度扩展
- **相关核心概念**
- **真实业务案例**
- **权衡与取舍**
- **进一步学习建议**

## Generation Rules

1. **风格对齐**：参考 bagujing 的“硬核、工程化、可落地”风格。避免空洞理论，多写“为什么这样答更好”“真实项目中怎么做”。
2. **口述框架必须可直接说**：使用口语化、有节奏的句子，适合面试官听。
3. **避坑要具体**：明确指出“说错这句话会直接减分”或“很多候选人卡在这里”。
4. **加分表达要可复制**：给出可以直接在面试中说的高级话术。
5. **变体树要有层次**：至少覆盖简化、加深、场景化、代码、对比 5 类。
6. **追问要真实**：模拟一线大厂面试官真实会追问的问题，并给出回答要点。
7. **深度扩展要实用**：给出可落地的案例、权衡维度和进一步学习路径。
8. 如果题目信息不足（无难度/公司），先合理推断再生成，并在开头注明假设。

## Quality Checklist (Internal)

Before outputting, mentally verify:
- 是否覆盖全部 8 个核心部分？
- 口述框架是否能在 90 秒内说完？
- 避坑是否具体到“减分项”？
- 加分表达是否真正能拉开差距？
- 追问是否有明确考察意图？
