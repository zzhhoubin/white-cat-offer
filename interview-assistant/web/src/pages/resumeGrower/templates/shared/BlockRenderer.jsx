import React from "react";
import { useTemplateContext } from "../TemplateContext";
import { getTemplateConfig } from "../registry";

/**
 * 通用块渲染器 — 根据 block 类型 + 模板配置计算样式
 * block 类型: header / section_title / paragraph / bullet / field_label / contact
 */
export default function BlockRenderer({ block, activeAnno, onAnnoClick, annoId }) {
  const { templateId } = useTemplateContext() || {};
  const cfg = getTemplateConfig(templateId);
  const cs = cfg?.colorScheme || {};
  const btype = block.type || "paragraph";
  const fontSize = block.size || 10.5;
  const isBold = block.bold;

  let marginLeft = 0;
  if (block.x >= 200) marginLeft = "24px";
  else if (block.x >= 130) marginLeft = "8px";

  const style = {
    fontSize: `${fontSize}pt`,
    fontWeight: isBold ? 700 : 400,
    marginLeft,
    lineHeight: cfg?.lineHeight || 1.7,
    color: block.color !== "#000000" && block.color !== "#000" ? block.color : (cs.text || "#1a1a1a"),
  };

  // 标题
  if (btype === "section_title" || (fontSize >= 13 && isBold)) {
    style.color = cs.heading || "#003366";
    style.fontWeight = 700;
    style.marginTop = `${(cfg?.spacing?.sectionGap || 20) - 6}px`;
    style.marginBottom = "4px";
    if (cfg?.sectionTitleStyle) {
      Object.assign(style, cfg.sectionTitleStyle);
    }
  }

  // 姓名头
  if (btype === "header") {
    style.fontSize = "22pt";
    style.fontWeight = 800;
    style.textAlign = cfg?.basicLayout || "center";
    style.marginBottom = "4px";
    style.color = cs.headerName || cs.heading || "#1a1a1a";
    style.marginLeft = 0;
  }

  // 联系方式行
  if (btype === "contact") {
    style.textAlign = "center";
    style.marginLeft = 0;
    style.color = cs.textSecondary || "#666";
  }

  // bullet
  if (btype === "bullet") {
    style.marginLeft = "32px";
    style.position = "relative";
  }

  const isActive = activeAnno && annoId === activeAnno;
  let cls = `rg-pb-styled rg-pb-${btype}`;
  if (annoId) cls += ` rg-has-anno${isActive ? " rg-anno-active" : ""}`;

  return (
    <div
      className={cls}
      style={style}
      onClick={annoId ? () => onAnnoClick(annoId) : undefined}
      title={annoId ? "点击查看批注" : undefined}
    >
      {block.text}
    </div>
  );
}
