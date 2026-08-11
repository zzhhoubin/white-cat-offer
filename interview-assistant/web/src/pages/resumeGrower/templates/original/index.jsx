import React from "react";
import BlockRenderer from "../shared/BlockRenderer";
import { groupBlocksIntoSections } from "../shared/groupBlocks";

/**
 * 原味纸面 —— 单栏逐块渲染，PDF 纸面还原默认风格
 */
export default function OriginalTemplate({ blocks, config, activeAnno, onAnnoClick, annotations }) {
  const cs = config?.colorScheme || {};
  const { headerBlocks, sections } = groupBlocksIntoSections(blocks);

  // 批注映射
  const quoteToAnno = new Map();
  (annotations || []).forEach((a) => { if (a.quote) quoteToAnno.set(a.quote, a.id); });
  function findAnno(text) {
    for (const [q, id] of quoteToAnno) {
      if (text.includes(q) || q.includes(text?.slice(0, 40) || "")) return id;
    }
    return null;
  }

  return (
    <div className="rg-tpl-root" style={{ background: cs.paperBg, padding: `${config?.spacing?.pagePadding || 32}px` }}>
      {/* Header 区：姓名 + 联系方式 */}
      <div style={{ marginBottom: "12px" }}>
        {headerBlocks.map((b, i) => (
          <BlockRenderer key={i} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
        ))}
      </div>

      {/* 正文 Section */}
      {sections.map((sec, si) => (
        <div key={si} style={{ marginBottom: `${config?.spacing?.sectionGap || 20}px` }}>
          <BlockRenderer block={sec.title} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(sec.title.text)} />
          {sec.blocks.map((b, bi) => (
            <BlockRenderer key={bi} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
          ))}
        </div>
      ))}
    </div>
  );
}
