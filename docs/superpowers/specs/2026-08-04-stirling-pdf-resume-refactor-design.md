# Stirling PDF 简历模块重构设计

**日期**: 2026-08-04
**范围**: 仅简历模块（`pages/resumeGrower/` + 后端 `/api/resume/` 路由）

## 目标

1. 上传 PDF 简历 → 解析 → 分析台展示（Stirling 风格 PDF Viewer）
2. 编辑按钮 → 编辑页直接修改 PDF 文本（像 Adobe Acrobat / Foxit）
3. 清理简历模块代码债务
4. 不动其他模块

## 架构

```
PDF 上传
  ↓
IndexedDB 存储原始 PDF（pdfStore.js）
  ↓
后端 Stirling API 提取文本（/api/convert/pdf/text）
  ↓
分析台：Stirling 风格 PDF Viewer + 评分/批注
  ↓ 点击编辑
编辑页：Stirling Text Editor 叠层编辑（contentEditable）
  ↓ 应用
回写 PDF → 更新预览
```

## 文件改动清单

### 重构文件

| 文件 | 改动 |
|------|------|
| `stirling/PdfViewer.jsx` | 加入文本层叠层，点击文本高亮选中，匹配 Stirling 原生渲染风格 |
| `stirling/PdfTextEditor.jsx` | 简化启动流程：直接 Stirling，不可用再降级 pdf.js；去掉双重加载 |
| `stirling/stirlingApi.js` | 保持不变 |
| `stirling/textGrouping.js` | 保持不变 |
| `ResumeDetail.jsx` | 统一为 Stirling Viewer + 纸面视图双模式；删除 rich HTML / 旧 PaperView 分支 |
| `CreateResume.jsx` | 简化 hasPdf 判断；清理状态管理 |
| `Resume.jsx` | 提取 useUpload hook；删除 offline 伪造数据兜底 |

### 删除的屎山

1. **`structuredResume.js`**: `heuristicStructuredFromText` 及相关正则猜结构化函数 — LLM 已覆盖
2. **`ResumeDetail.jsx`**: `PaperView` 组件的 rich/basics/bullet 多分支渲染 — 统一用模板组件
3. **`Resume.jsx`**: `handleUpload` 中 `catch` 块伪造 offline 数据 — 直接提示错误
4. **`PdfTextEditor.jsx`**: pdf.js 先加载再换 Stirling 的双重启动 — 直接 Stirling 优先
5. **`ResumeDetail.jsx`**: `StructuredEditor` 已删除的注释残留

### 不动文件

- `editor/` 目录（store、SectionList、SectionEditor、LivePreview 等）
- `storage.js`、`pdfStore.js`
- `JdMatchTab.jsx`、`MaterialsTab.jsx`、`LibraryTab.jsx`、`ProfileTab.jsx`
- 后端 `app.py` 和 `stirling_client.py`
- 其他模块（题库、面经、面试等）

## 用户交互流程

```
1. 上传页拖拽 PDF
2. 后端 Stirling 提取文本
3. 跳转分析台 (/resume?id=xxx)
   - 左：Stirling 风格 Viewer（工具栏、翻页、缩放、搜索、文本选中）
   - 右：评分 + 批注
4. 点击 [编辑] → 编辑页 (/resume?tab=create&id=xxx)
   - 右栏：PDF Text Editor
   - 点击文本对象直接修改（contentEditable）
   - [应用到 PDF] 按钮回写
```

## 关键实现细节

### PdfViewer 升级
- 在 canvas 上叠加文本层（从 pdf.js getTextContent 获取）
- 文本区域 hover 高亮、click 选中
- 工具栏：搜索、平移、选择、缩放、暗色模式
- 翻页保持缩放状态

### PdfTextEditor 简化
- `bootstrap()` 直接调用 Stirling `openTextEditor`
- 仅 Stirling 返回 4xx/5xx 时才降级到 pdf.js 文本层
- 删除 pdf.js 先行加载逻辑

### 错误处理
- Stirling 不可用时：提示"请启动 Docker Stirling PDF 服务"
- PDF 解析失败时：直接报错，不伪造数据
- 所有错误信息用 `onStatus` 回调统一展示
