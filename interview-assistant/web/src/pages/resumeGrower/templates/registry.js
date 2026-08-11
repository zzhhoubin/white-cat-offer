/**
 * 模板注册表 —— 仿 magic-resume 架构
 * 添加新模板：建目录（config.js + index.jsx），然后在这里加一条记录。
 * 模板来源参考：
 *   - Awesome CV      github.com/posquit0/Awesome-CV
 *   - AltaCV           github.com/liantze/AltaCV
 *   - React Ultimate   github.com/LaurenceMarcotte/react-ultimate-resume
 *   - Twenty Seconds   github.com/spagnuolocarmine/TwentySecondsCurriculumVitae-LaTex
 */

import OriginalTemplate from "./original/index.jsx";
import ClassicTemplate from "./classic/index.jsx";
import ModernTemplate from "./modern/index.jsx";
import ElegantTemplate from "./elegant/index.jsx";
import SplitTemplate from "./split/index.jsx";

// ---- 模板配置 ----
// 每个模板 = config（纯数据）+ Component（React 组件）

export const originalConfig = {
  id: "original",
  name: "原味纸面",
  source: "pymupdf 纸面还原（默认）",
  previewColor: "#003366",
  colorScheme: {
    heading: "#003366",
    headingBorder: "#e0e0e0",
    headerName: "#1a1a1a",
    text: "#1a1a1a",
    textSecondary: "#666",
    bullet: "#003366",
    accent: "#2f7d58",
    paperBg: "#ffffff",
    divider: "#e0e0e0",
  },
  spacing: { sectionGap: 20, itemGap: 8, pagePadding: 32 },
  basicLayout: "center",
  lineHeight: 1.7,
  sectionTitleStyle: {
    borderBottom: "1.5px solid #e0e0e0",
    paddingBottom: "4px",
    marginBottom: "6px",
  },
};

export const classicConfig = {
  id: "classic",
  name: "经典黑白",
  source: "github.com/posquit0/Awesome-CV",
  previewColor: "#2C3E50",
  colorScheme: {
    heading: "#2C3E50",
    headingBorder: "#2C3E50",
    headerName: "#2C3E50",
    text: "#333",
    textSecondary: "#7f8c8d",
    bullet: "#2980B9",
    accent: "#2980B9",
    paperBg: "#fafafa",
    divider: "#bdc3c7",
  },
  spacing: { sectionGap: 22, itemGap: 10, pagePadding: 36 },
  basicLayout: "left",
  lineHeight: 1.7,
  sectionTitleStyle: {
    borderBottom: "1.5px solid #2C3E50",
    paddingBottom: "4px",
    marginBottom: "8px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
};

export const modernConfig = {
  id: "modern",
  name: "现代蓝调",
  source: "github.com/LaurenceMarcotte/react-ultimate-resume",
  previewColor: "#1976D2",
  colorScheme: {
    heading: "#1976D2",
    headingBorder: "#90CAF9",
    headerName: "#0D47A1",
    text: "#212121",
    textSecondary: "#757575",
    bullet: "#1976D2",
    accent: "#388E3C",
    paperBg: "#ffffff",
    divider: "#E0E0E0",
  },
  spacing: { sectionGap: 18, itemGap: 8, pagePadding: 32 },
  basicLayout: "center",
  lineHeight: 1.65,
  sectionTitleStyle: {
    borderLeft: "4px solid #1976D2",
    paddingLeft: "10px",
    paddingBottom: "2px",
    marginBottom: "8px",
    borderBottom: "none",
  },
};

export const elegantConfig = {
  id: "elegant",
  name: "优雅极简",
  source: "github.com/liantze/AltaCV",
  previewColor: "#4A6274",
  colorScheme: {
    heading: "#4A6274",
    headingBorder: "transparent",
    headerName: "#222",
    text: "#333",
    textSecondary: "#888",
    bullet: "#4A6274",
    accent: "#7695a7",
    paperBg: "#ffffff",
    divider: "#cfd8dc",
  },
  spacing: { sectionGap: 24, itemGap: 8, pagePadding: 40 },
  basicLayout: "center",
  lineHeight: 1.75,
  sectionTitleStyle: {
    borderBottom: "none",
    paddingBottom: "0",
    marginBottom: "6px",
    fontSize: "14pt",
    letterSpacing: "0.08em",
  },
};

export const splitConfig = {
  id: "split",
  name: "双栏侧边",
  source: "github.com/spagnuolocarmine/TwentySecondsCurriculumVitae-LaTex",
  previewColor: "#2E7D32",
  colorScheme: {
    heading: "#ffffff",
    headingBorder: "rgba(255,255,255,0.3)",
    headerName: "#ffffff",
    text: "#333",
    textSecondary: "#777",
    bullet: "#81C784",
    accent: "#00796B",
    paperBg: "#fcfcfc",
    divider: "#C8E6C9",
    sidebarBg: "#2E7D32",
    sidebarText: "#ffffff",
    sidebarTextSecondary: "rgba(255,255,255,0.75)",
  },
  spacing: { sectionGap: 16, itemGap: 6, pagePadding: 0 },
  basicLayout: "left",
  lineHeight: 1.6,
  sectionTitleStyle: {
    borderBottom: "1px solid rgba(255,255,255,0.3)",
    paddingBottom: "4px",
    marginBottom: "6px",
  },
};

// ---- 注册表 ----
const TEMPLATE_REGISTRY = [
  { config: originalConfig, Component: OriginalTemplate },
  { config: classicConfig, Component: ClassicTemplate },
  { config: modernConfig, Component: ModernTemplate },
  { config: elegantConfig, Component: ElegantTemplate },
  { config: splitConfig, Component: SplitTemplate },
];

/** 按 id 查配置 */
export function getTemplateConfig(id) {
  const entry = TEMPLATE_REGISTRY.find((e) => e.config.id === id);
  return entry ? entry.config : TEMPLATE_REGISTRY[0].config;
}

/** 按 id 查组件 */
export function getTemplateComponent(id) {
  const entry = TEMPLATE_REGISTRY.find((e) => e.config.id === id);
  return entry ? entry.Component : TEMPLATE_REGISTRY[0].Component;
}

/** 所有模板配置列表（供下拉 UI 用） */
export function listTemplateConfigs() {
  return TEMPLATE_REGISTRY.map((e) => e.config);
}

export default TEMPLATE_REGISTRY;
