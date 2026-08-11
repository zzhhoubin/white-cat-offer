import React from "react";
import BlockRenderer from "../shared/BlockRenderer";
import { groupBlocksIntoSections } from "../shared/groupBlocks";

/**
 * 现代蓝调 —— React Ultimate Resume 风格
 * 居中头部，section 左侧彩色竖线，无下划线
 */
export default function ModernTemplate({ blocks, config, activeAnno, onAnnoClick, annotations }) {
  const cs = config?.colorScheme || {};
  const sp = config?.spacing || {};
  const { headerBlocks, sections } = groupBlocksIntoSections(blocks);

  const quoteToAnno = new Map();
  (annotations || []).forEach((a) => { if (a.quote) quoteToAnno.set(a.quote, a.id); });
  function findAnno(text) {
    for (const [q, id] of quoteToAnno) {
      if (text.includes(q) || q.includes(text?.slice(0, 40) || "")) return id;
    }
    return null;
  }

  return (
    <div className="rg-tpl-root" style={{ background: cs.paperBg, padding: `${sp.pagePadding || 32}px` }}>
      {/* Header：居中，彩色竖线装饰 */}
      <div style={{ textAlign: "center", marginBottom: "18px", paddingBottom: "12px" }}>
        {headerBlocks.map((b, i) => {
          const annoId = findAnno(b.text);
          const style = {
            fontSize: b.type === "header" ? "24pt" : `${b.size || 10.5}pt`,
            fontWeight: b.type === "header" ? 800 : (b.bold ? 600 : 400),
            color: b.type === "header" ? cs.headerName : cs.textSecondary,
            textAlign: "center",
            marginBottom: b.type === "header" ? "2px" : "0",
          };
          let cls = `rg-pb-styled rg-pb-${b.type || "paragraph"}`;
          if (annoId) cls += ` rg-has-anno${activeAnno === annoId ? " rg-anno-active" : ""}`;
          return (
            <div key={i} className={cls} style={style}
              onClick={annoId ? () => onAnnoClick(annoId) : undefined}
              title={annoId ? "点击查看批注" : undefined}>
              {b.text}
            </div>
          );
        })}
      </div>
      {/* 分隔线 */}
      <div style={{ height: "3px", background: `linear-gradient(to right, ${cs.heading}, transparent)`, marginBottom: "16px" }} />

      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: `${sp.sectionGap || 18}px` }}>
          <BlockRenderer block={sec.title} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(sec.title.text)} />
          {sec.blocks.map((b, bi) => (
            <BlockRenderer key={bi} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
          ))}
        </div>
      ))}
    </div>
  );
}
