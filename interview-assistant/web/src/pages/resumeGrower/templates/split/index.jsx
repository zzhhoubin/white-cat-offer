import React from "react";
import BlockRenderer from "../shared/BlockRenderer";
import { groupBlocksIntoSections, splitSidebarBlocks } from "../shared/groupBlocks";

/**
 * 双栏侧边 —— Twenty Seconds CV 风格
 * 左侧彩色边栏（基本信息/技能/联系方式），右侧正文区域
 */
export default function SplitTemplate({ blocks, config, activeAnno, onAnnoClick, annotations }) {
  const cs = config?.colorScheme || {};
  const sp = config?.spacing || {};
  const { headerBlocks, sections: allSections } = groupBlocksIntoSections(blocks);
  const { sidebar, main } = splitSidebarBlocks(allSections);

  const quoteToAnno = new Map();
  (annotations || []).forEach((a) => { if (a.quote) quoteToAnno.set(a.quote, a.id); });
  function findAnno(text) {
    for (const [q, id] of quoteToAnno) {
      if (text.includes(q) || q.includes(text?.slice(0, 40) || "")) return id;
    }
    return null;
  }

  const sidebarStyle = {
    width: "240px",
    flexShrink: 0,
    background: cs.sidebarBg || cs.heading,
    color: cs.sidebarText || "#fff",
    padding: "28px 20px",
    minHeight: "100%",
  };

  const mainStyle = {
    flex: 1,
    padding: `${sp.pagePadding || 28}px`,
    background: cs.paperBg,
  };

  function renderSidebarBlock(b, i) {
    const annoId = findAnno(b.text);
    const fontSize = b.size || 10;
    const style = {
      fontSize: `${fontSize}pt`,
      fontWeight: b.bold ? 700 : 400,
      color: cs.sidebarText || "#fff",
      marginBottom: "2px",
      lineHeight: 1.6,
    };
    if (b.type === "header") {
      style.fontSize = "17pt";
      style.fontWeight = 800;
      style.marginBottom = "8px";
      style.textAlign = "center";
    }
    if (b.type === "section_title" || (b.size >= 13 && b.bold)) {
      style.fontSize = `${Math.max(fontSize, 12)}pt`;
      style.fontWeight = 700;
      style.marginTop = "14px";
      style.marginBottom = "4px";
      style.borderBottom = `1px solid ${cs.sidebarTextSecondary || "rgba(255,255,255,0.3)"}`;
      style.paddingBottom = "3px";
      style.color = cs.sidebarText || "#fff";
    }
    let cls = `rg-pb-styled rg-pb-${b.type || "paragraph"}`;
    if (annoId) cls += ` rg-has-anno${activeAnno === annoId ? " rg-anno-active" : ""}`;
    return (
      <div key={i} className={cls} style={style}
        onClick={annoId ? () => onAnnoClick(annoId) : undefined}
        title={annoId ? "点击查看批注" : undefined}>
        {b.text}
      </div>
    );
  }

  return (
    <div className="rg-tpl-root rg-tpl-split" style={{ display: "flex", minHeight: "100%" }}>
      {/* 左侧边栏 */}
      <div style={sidebarStyle}>
        {headerBlocks.map((b, i) => renderSidebarBlock(b, i))}
        {sidebar.map((sec, si) => (
          <div key={`s-${si}`}>
            {renderSidebarBlock(sec.title, `st-${si}`)}
            {sec.blocks.map((b, bi) => renderSidebarBlock(b, `sb-${si}-${bi}`))}
          </div>
        ))}
      </div>

      {/* 右侧正文 */}
      <div style={mainStyle}>
        {main.map((sec, si) => (
          <div key={si} style={{ marginBottom: `${sp.sectionGap || 16}px` }}>
            <BlockRenderer block={sec.title} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(sec.title.text)} />
            {sec.blocks.map((b, bi) => (
              <BlockRenderer key={bi} block={b} activeAnno={activeAnno} onAnnoClick={onAnnoClick} annoId={findAnno(b.text)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
