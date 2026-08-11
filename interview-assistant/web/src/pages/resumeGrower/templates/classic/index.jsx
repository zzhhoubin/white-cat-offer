import React from "react";
import BlockRenderer from "../shared/BlockRenderer";
import { groupBlocksIntoSections } from "../shared/groupBlocks";

/**
 * 经典黑白 —— Awesome CV 风格
 * 左对齐头部，section 标题全大写加下划线，清晰专业
 */
export default function ClassicTemplate({ blocks, config, activeAnno, onAnnoClick, annotations }) {
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
    <div className="rg-tpl-root" style={{ background: cs.paperBg, padding: `${sp.pagePadding || 36}px` }}>
      {/* Header：左对齐 */}
      <div style={{ marginBottom: "16px", borderBottom: `2px solid ${cs.heading}`, paddingBottom: "10px" }}>
        {headerBlocks.map((b, i) => {
          const annoId = findAnno(b.text);
          const style = {
            fontSize: b.type === "header" ? "24pt" : `${b.size || 10.5}pt`,
            fontWeight: b.type === "header" ? 800 : (b.bold ? 600 : 400),
            color: b.type === "header" ? cs.headerName : cs.textSecondary,
            textAlign: "left",
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

      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: `${sp.sectionGap || 22}px` }}>
          <BlockRenderer block={sec.title} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(sec.title.text)} />
          {sec.blocks.map((b, bi) => (
            <BlockRenderer key={bi} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
          ))}
        </div>
      ))}
    </div>
  );
}
