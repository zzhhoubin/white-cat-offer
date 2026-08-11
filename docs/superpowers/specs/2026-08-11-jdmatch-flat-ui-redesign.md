# 岗位匹配度分析模块 · 扁平化 UI 重设计

**日期：** 2026-08-11
**范围：** `JdMatchTab.jsx` 3 个 Tab 页 + 左侧历史栏，仅 CSS 改动
**目标：** 采用现代扁平化设计，不改动任何 JSX 结构和业务逻辑
**方案：** 方案 B · Clean Card 现代扁平

---

## 视觉语言

### 色彩系统

| 角色 | 色值 | 用途 |
|------|------|------|
| 主强调色 | `#3b82f6` | Tab 激活态、进度条、A 级标记、链接 |
| 成功/优势 | `#10b981` | 竞争优势、通过状态、亮点 |
| 警告/中等 | `#f59e0b` | B 级标签、中风险、需注意 |
| 危险/高风险 | `#ef4444` | C 级标签、硬伤、高风险/不通过 |
| 正文 | `#1e293b` | 主要文字 |
| 次要文字 | `#64748b` | 辅助说明、日期、权重信息 |
| 边框 | `#e2e8f0` | 卡片和输入框边框 |
| 卡片白底 | `#ffffff` | 所有卡片背景 |
| 浅底 | `#f8fafc` | Hero 区、hover 态 |
| 页面底 | `#f1f5f9` | 整体页面背景 |

### 视觉规则

- **去除所有渐变**：`linear-gradient` / `radial-gradient` / `box-shadow` 全部移除
- **卡片阴影**：仅保留 `0 1px 3px rgba(0,0,0,0.04)` 极微弱阴影
- **圆角统一**：卡片/输入框/按钮 8px，标签 4px
- **间距栅格**：4 / 8 / 12 / 16 / 20 / 24 / 32px
- **字体**：沿用 `--font-body`，标题 15px/700，正文 13-14px，行高 1.6

---

## 逐区域改动

### 1. Tab 栏（`.rg-jdm-tabs`）

**现状：** 灰色底 `#eef2f0`，胶囊切换
**改为：** 底部 2px 指示线，无背景色

```css
.rg-jdm-tabs {
  display: flex; gap: 24px; margin: 4px 0 16px;
  padding: 0; border-radius: 0; background: none;
  border-bottom: 1px solid #e2e8f0;
}
.rg-jdm-tabs button {
  flex: 0 0 auto; border: 0; background: none;
  padding: 10px 4px; font-size: 14px; font-weight: 500;
  color: #64748b; cursor: pointer; border-radius: 0;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.rg-jdm-tabs button.active {
  background: none; color: #3b82f6; font-weight: 700;
  border-bottom-color: #3b82f6;
  box-shadow: none;
}
```

### 2. Hero 总分区（`.rg-jdm-hero`）

**现状：** radial-gradient 渐变 + 分数圆环 box-shadow + 绿色边框
**改为：** 纯浅灰底 + 左边 4px 蓝条 + 分数圆环极简化

```css
.rg-jdm-hero {
  display: flex; gap: 16px; align-items: center;
  padding: 20px 20px 20px 24px; border-radius: 8px;
  background: #f8fafc; border: 1px solid #e2e8f0;
  border-left: 4px solid #3b82f6; /* 等分级色条：A=绿 B=黄 C=红 */
  margin-bottom: 20px;
}
.rg-jdm-score {
  width: 80px; height: 80px; border-radius: 50%;
  background: #fff; border: 2px solid #e2e8f0;
  /* 去掉 box-shadow */
}
.rg-jdm-score strong {
  font-size: 32px; color: #3b82f6;
}
```

等级色条随分数变化：
- `.hero-a` → `border-left-color: #10b981`
- `.hero-b` → `border-left-color: #f59e0b`
- `.hero-c` → `border-left-color: #ef4444`

### 3. 左侧历史记录栏（`.rg-jdm-hist`）

**选中态改为蓝色系：**

```css
.rg-jdm-hist-item {
  border: 1px solid #e2e8f0; border-radius: 8px;
  background: #fff; padding: 10px 12px;
  border-left: 3px solid transparent;
}
.rg-jdm-hist-item.active {
  border-color: #e2e8f0;
  border-left-color: #3b82f6;
  background: #eff6ff;
}
```

### 4. 各 section 卡片统一

所有 `.rg-jdm-dim` / `.rg-jdm-opt` / `.rg-jdm-panel` / `.rg-jdm-recon-block`：

```css
/* 统一白底卡片 */
.rg-jdm-dim { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
.rg-jdm-opt { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
.rg-jdm-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
.rg-jdm-recon-block { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
.rg-jdm-culture { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; }
```

### 5. 进度条（`.rg-bar`）

```css
.rg-jdm-result .rg-bar { height: 6px; border-radius: 3px; background: #f1f5f9; }
.rg-jdm-result .rg-bar > i {
  background: #3b82f6; /* 纯色，去掉渐变 */
}
```

### 6. 竞争优势/短板网格（`.rg-jdm-gap-grid`）

**用顶部色条替代背景色：**

```css
.rg-jdm-panel-ok { border-top: 3px solid #10b981; background: #fff; }
.rg-jdm-panel-gap { border-top: 3px solid #f59e0b; background: #fff; }
```

### 7. section 分隔（`.rg-jdm-sec`）

```css
.rg-jdm-sec {
  margin-bottom: 20px; padding-left: 0;
  border-left: none; /* 去掉左侧绿色分隔条 */
}
```

### 8. 确认区（`.rg-jdm-confirm`）

```css
.rg-jdm-confirm {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px solid #e2e8f0; /* 实线替代虚线 */
}
```

### 9. 风险卡片（`.rg-jdm-opt-risk`）

**用左边框色区分等级，去掉背景色：**

```css
.rg-jdm-opt-risk.lv-h { border-left: 3px solid #ef4444; background: #fff; }
.rg-jdm-opt-risk.lv-m { border-left: 3px solid #f59e0b; background: #fff; }
.rg-jdm-opt-risk.lv-l { border-left: 3px solid #94a3b8; background: #fff; }
```

### 10. 导出按钮组

```css
.rg-jdm-export { border-top: 1px solid #e2e8f0; /* 实线 */ }
```

---

## 不改动的范围

- JSX 结构和 className 名称
- 组件内部状态逻辑和 API 调用
- 响应式 `@media (max-width: 900px)` 断点保留
- 按钮通用 `.btn` / `.btn.primary` / `.btn.ghost` 等全局样式（可能被其他页面共用）

## 涉及文件

- **唯一改动文件：** `interview-assistant/web/src/styles.css`（L7396-L8032 区间）
- **不改动：** `JdMatchTab.jsx`、`ResumeDetail.jsx`、`tokens.css`

## 改动统计

| 类型 | 数量 |
|------|------|
| 去除渐变 | 3 处（hero + bar + tabs bg） |
| 去除阴影 | 3 处（score circle + tab active + tier list） |
| 色值替换（绿→蓝） | ~15 处 |
| 统一卡片样式 | ~8 条规则 |
| 简化边框/分隔 | ~5 条规则 |
