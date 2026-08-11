/** 在 PDF 文本层中为批注定位页码与包围盒 */

export function buildTextIndex(pages) {
  /** @type {{ page: number, text: string, x: number, y: number, w: number, h: number, id: string }[]} */
  const items = [];
  (pages || []).forEach((p) => {
    (p.items || []).forEach((it) => {
      if (!it?.text?.trim()) return;
      items.push({
        page: p.page,
        text: it.text,
        x: it.x,
        y: it.y,
        w: it.w,
        h: it.h,
        id: it.id,
      });
    });
  });
  return items;
}

function normalize(s) {
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[·•|｜]/g, "")
    .toLowerCase();
}

/** 在文本层中查找 quote，返回 { page, itemIds, rects } */
export function locateQuoteInPages(pages, quote) {
  const q = normalize(quote);
  if (!q || q.length < 4) return null;
  const items = buildTextIndex(pages);
  if (!items.length) return null;

  // 优先整条 item 包含
  for (const it of items) {
    const t = normalize(it.text);
    if (t && (t.includes(q.slice(0, Math.min(24, q.length))) || q.includes(t.slice(0, Math.min(24, t.length))))) {
      if (t.length >= 4 || q.includes(t)) {
        return {
          page: it.page,
          itemIds: [it.id],
          rects: [{ x: it.x, y: it.y, w: it.w, h: it.h }],
        };
      }
    }
  }

  // 滑动拼接邻近 items（同页）
  const byPage = new Map();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }
  const needle = q.slice(0, Math.min(40, q.length));
  for (const [page, list] of byPage) {
    let acc = "";
    const used = [];
    for (let i = 0; i < list.length; i++) {
      acc = "";
      used.length = 0;
      for (let j = i; j < Math.min(i + 12, list.length); j++) {
        acc += normalize(list[j].text);
        used.push(list[j]);
        if (acc.includes(needle)) {
          return {
            page,
            itemIds: used.map((u) => u.id),
            rects: used.map((u) => ({ x: u.x, y: u.y, w: u.w, h: u.h })),
          };
        }
        if (acc.length > needle.length + 80) break;
      }
    }
  }
  return null;
}

/** 给批注列表补上 page / anchor（不改 title/body） */
export function attachAnnotationAnchors(annotations, pages) {
  return (annotations || []).map((a) => {
    if (!a?.quote) return { ...a, page: a.page ?? null, anchor: a.anchor ?? null };
    const hit = locateQuoteInPages(pages, a.quote);
    if (!hit) return { ...a, page: a.page ?? null, anchor: a.anchor ?? null };
    return {
      ...a,
      page: hit.page,
      anchor: { itemIds: hit.itemIds, rects: hit.rects },
    };
  });
}
