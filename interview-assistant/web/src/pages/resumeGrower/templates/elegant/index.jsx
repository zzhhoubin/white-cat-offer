import React from "react";
import BlockRenderer from "../shared/BlockRenderer";
import { groupBlocksIntoSections } from "../shared/groupBlocks";

/**
 * 优雅极简 —— AltaCV 风格
 * 大留白，标题无边框仅加粗，极简克制
 */
export default function ElegantTemplate({ blocks, config, activeAnno, onAnnoClick, annotations }) {
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
    <div className="rg-tpl-root" style={{ background: cs.paperBg, padding: `${sp.pagePadding || 40}px` }}>
      {/* Header：大字号居中，大量留白 */}
      <div style={{ textAlign: "center", marginBottom: "28px" }}>
        {headerBlocks.map((b, i) => {
          const annoId = findAnno(b.text);
          const style = {
            fontSize: b.type === "header" ? "26pt" : `${b.size || 10.5}pt`,
            fontWeight: b.type === "header" ? 700 : (b.bold ? 500 : 300),
            color: b.type === "header" ? cs.headerName : cs.textSecondary,
            textAlign: "center",
            marginBottom: b.type === "header" ? "4px" : "0",
            letterSpacing: b.type === "header" ? "0.03em" : "0",
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

      {/* 细线分隔 */}
      <div style={{ width: "60px", height: "1px", background: cs.divider, margin: "0 auto 24px" }} />

      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: `${sp.sectionGap || 24}px` }}>
          <BlockRenderer block={sec.title} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(sec.title.text)} />
          {sec.blocks.map((b, bi) => (
            <BlockRenderer key={bi} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
          ))}
        </div>
      ))}
    </div>
  );
}
