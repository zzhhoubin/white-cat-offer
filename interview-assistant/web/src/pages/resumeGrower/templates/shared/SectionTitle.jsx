import React from "react";
import { useTemplateContext } from "../TemplateContext";
import { getTemplateConfig } from "../registry";

/** 通用标题渲染器 — 各模板通过 config.sectionTitleStyle 控制外观 */
export default function SectionTitle({ block }) {
  const { templateId } = useTemplateContext() || {};
  const config = getTemplateConfig(templateId);
  const styleCfg = config?.sectionTitleStyle || {};

  const style = {
    fontSize: `${block.size || 13.5}pt`,
    fontWeight: 700,
    color: config?.colorScheme?.heading || "#003366",
    ...styleCfg,
  };

  return <div style={style}>{block.text}</div>;
}
