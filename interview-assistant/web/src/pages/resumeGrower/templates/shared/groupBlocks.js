/**
 * 把平铺的 layout_blocks 分组为 { header, sections[] }
 * - header: 姓名 + 联系方式（第一个 section_title 之前的块）
 * - sections: [{ title: block, blocks: [] }] 每个 section_title + 其下属内容
 */
export function groupBlocksIntoSections(allBlocks) {
  const blocks = allBlocks || [];
  if (!blocks.length) return { headerBlocks: [], sections: [] };

  // 找到第一个 section_title 的位置
  let firstTitleIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "section_title" || (b.size >= 13 && b.bold && b.type !== "header")) {
      firstTitleIdx = i;
      break;
    }
  }

  // 第一个标题之前的都是 header
  const headerBlocks = firstTitleIdx === -1 ? [...blocks] : blocks.slice(0, firstTitleIdx);

  // 按标题分组
  const sections = [];
  let current = null;
  for (let i = firstTitleIdx === -1 ? blocks.length : firstTitleIdx; i < blocks.length; i++) {
    const b = blocks[i];
    const isTitle = b.type === "section_title" || (b.size >= 13 && b.bold && b.type !== "header");
    if (isTitle) {
      if (current) sections.push(current);
      current = { title: b, blocks: [] };
    } else if (current) {
      current.blocks.push(b);
    }
  }
  if (current) sections.push(current);

  return { headerBlocks, sections };
}

/**
 * 把平铺块分为 sidebar 候选 和 正文候选
 * 用于双栏模板：基本信息/联系方式/技能 → 侧边栏，其余 → 正文
 */
const SIDEBAR_SECTION_KEYS = ["基本信息", "联系方式", "技能", "语言能力", "语言", "证书", "获奖", "荣誉"];

export function splitSidebarBlocks(sections) {
  const sidebar = [];
  const main = [];
  for (const sec of sections) {
    const title = (sec.title?.text || "").replace(/\s/g, "");
    if (SIDEBAR_SECTION_KEYS.some((k) => title.includes(k))) {
      sidebar.push(sec);
    } else {
      main.push(sec);
    }
  }
  // 如果侧边栏为空，把前两个 section 放进去
  if (!sidebar.length && sections.length >= 2) {
    sidebar.push(sections[0], sections[1]);
    main.splice(0, 2);
  }
  return { sidebar, main };
}
