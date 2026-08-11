const KEY = "resume_grower_v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function getResumes() {
  return load().resumes || [];
}

export function setResumes(resumes) {
  const data = load();
  data.resumes = resumes;
  save(data);
}

export function getResume(id) {
  return getResumes().find((r) => r.id === id) || null;
}

export function upsertResume(resume) {
  const list = getResumes();
  const i = list.findIndex((r) => r.id === resume.id);
  if (i >= 0) list[i] = resume;
  else list.unshift(resume);
  setResumes(list);
  return resume;
}

export function deleteResume(id) {
  const list = getResumes().filter((r) => r.id !== id);
  setResumes(list);
  return list;
}

export function getMaterials() {
  return load().materials || [];
}

export function setMaterials(materials) {
  const data = load();
  data.materials = materials;
  save(data);
}

export function deleteMaterial(id) {
  const list = getMaterials().filter((m) => m.id !== id);
  setMaterials(list);
  return list;
}

export function getProjectPacks() {
  return load().projectPacks || [];
}

export function setProjectPacks(packs) {
  const data = load();
  data.projectPacks = packs;
  save(data);
}

export function upsertProjectPack(pack) {
  const list = getProjectPacks();
  const i = list.findIndex((p) => p.id === pack.id);
  if (i >= 0) list[i] = pack;
  else list.unshift(pack);
  setProjectPacks(list);
  return pack;
}

export function deleteProjectPack(id) {
  const list = getProjectPacks().filter((p) => p.id !== id);
  setProjectPacks(list);
  return list;
}

/** 项目深挖页资料列表隐藏 id（不删资料库） */
export function getMaterialsTabHiddenIds() {
  const list = load().materialsTabHiddenIds || [];
  return Array.isArray(list) ? list : [];
}

export function hideMaterialFromMaterialsTab(fileId) {
  if (!fileId) return getMaterialsTabHiddenIds();
  const set = new Set(getMaterialsTabHiddenIds());
  set.add(fileId);
  const data = load();
  data.materialsTabHiddenIds = [...set];
  save(data);
  return data.materialsTabHiddenIds;
}

/** 从本地简历列表汇总可拖入资料包的项目 */
export function collectResumeProjects(resumes = getResumes()) {
  const out = [];
  for (const r of resumes || []) {
    const projects = r?.structured?.projects || [];
    projects.forEach((p, index) => {
      if (!p) return;
      out.push({
        id: `rp_${r.id}_${index}`,
        resumeId: r.id,
        resumeName: r.name || "未命名简历",
        projectIndex: index,
        name: p.name || `项目${index + 1}`,
        role: p.role || "",
        company: p.company || "",
        intro: p.intro || "",
        responsibilities: p.responsibilities || [],
        achievements: p.achievements || [],
        bullets: p.bullets || [],
        start: p.start || "",
        end: p.end || "",
      });
    });
  }
  return out;
}

export function getProfile() {
  return load().profile || null;
}

export function setProfile(profile) {
  const data = load();
  data.profile = profile;
  save(data);
}

/* ---------- 我的资料库（树形：parentId=null 为根） ---------- */

export function getLibraryItems() {
  return load().libraryItems || [];
}

export function setLibraryItems(items) {
  const data = load();
  data.libraryItems = items;
  save(data);
}

function _nowIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function listLibraryChildren(parentId = null) {
  return getLibraryItems()
    .filter((x) => (x.parentId ?? null) === (parentId ?? null))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
}

export function getLibraryItem(id) {
  return getLibraryItems().find((x) => x.id === id) || null;
}

export function getLibraryPath(id) {
  const items = getLibraryItems();
  const path = [];
  let cur = items.find((x) => x.id === id) || null;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? items.find((x) => x.id === cur.parentId) : null;
  }
  return path;
}

function _parentKey(parentId) {
  return parentId || null;
}

/** 同目录下名称是否已被占用（excludeIds 内的项不参与冲突） */
function _nameTaken(items, parentId, name, excludeIds = null) {
  const pid = _parentKey(parentId);
  const n = String(name || "").trim();
  if (!n) return false;
  const skip = excludeIds instanceof Set ? excludeIds : excludeIds ? new Set(excludeIds) : null;
  return items.some(
    (x) =>
      _parentKey(x.parentId) === pid &&
      String(x.name || "").trim() === n &&
      !(skip && skip.has(x.id))
  );
}

function _assertNameFree(items, parentId, name, excludeIds = null) {
  const n = String(name || "").trim();
  if (!n) throw new Error("名称不能为空");
  if (_nameTaken(items, parentId, n, excludeIds)) {
    throw new Error(`同目录下已存在「${n}」，不能重名`);
  }
}

/** 生成同目录下不冲突的名称（用于复制） */
function _allocUniqueName(items, parentId, desired, excludeIds = null) {
  const base = String(desired || "未命名").trim() || "未命名";
  if (!_nameTaken(items, parentId, base, excludeIds)) return base;
  const i = base.lastIndexOf(".");
  const hasExt = i > 0 && i < base.length - 1;
  const stem = hasExt ? base.slice(0, i) : base;
  const ext = hasExt ? base.slice(i) : "";
  for (let n = 1; n < 1000; n++) {
    const tryName = n === 1 ? `${stem} 副本${ext}` : `${stem} 副本${n}${ext}`;
    if (!_nameTaken(items, parentId, tryName, excludeIds)) return tryName;
  }
  return `${stem} 副本${Date.now()}${ext}`;
}

export function createLibraryFolder(name, parentId = null) {
  const items = getLibraryItems();
  const folderName = (name || "新建文件夹").trim() || "新建文件夹";
  _assertNameFree(items, parentId, folderName);
  const folder = {
    id: "lib_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    parentId: parentId || null,
    name: folderName,
    type: "folder",
    size: 0,
    mime: "",
    updatedAt: _nowIso(),
    content: "",
  };
  items.unshift(folder);
  setLibraryItems(items);
  return folder;
}

export function addLibraryFile({ name, size = 0, mime = "", content = "", parentId = null, hasBlob = false, tagIds = [] }) {
  const items = getLibraryItems();
  const fileName = (name || "未命名文件").trim() || "未命名文件";
  _assertNameFree(items, parentId, fileName);
  const file = {
    id: "lib_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    parentId: parentId || null,
    name: fileName,
    type: "file",
    size: Number(size) || 0,
    mime: mime || "",
    updatedAt: _nowIso(),
    content: content || "",
    hasBlob: Boolean(hasBlob),
    tagIds: Array.isArray(tagIds) ? tagIds : [],
  };
  items.unshift(file);
  setLibraryItems(items);
  return file;
}

export function renameLibraryItem(id, name) {
  const nextName = (name || "").trim();
  if (!nextName) return null;
  const items = getLibraryItems();
  const cur = items.find((x) => x.id === id);
  if (!cur) return null;
  _assertNameFree(items, cur.parentId, nextName, [id]);
  const next = items.map((x) =>
    x.id === id ? { ...x, name: nextName, updatedAt: _nowIso() } : x
  );
  setLibraryItems(next);
  return next.find((x) => x.id === id) || null;
}

function _collectDescendantIds(items, id) {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of items) {
      if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) {
        ids.add(x.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function deleteLibraryItems(ids) {
  const idSet = new Set(ids || []);
  if (!idSet.size) return getLibraryItems();
  let items = getLibraryItems();
  const remove = new Set();
  for (const id of idSet) {
    for (const d of _collectDescendantIds(items, id)) remove.add(d);
  }
  items = items.filter((x) => !remove.has(x.id));
  setLibraryItems(items);
  return items;
}

/** 移动到目标文件夹；禁止移入自身或子孙目录；目标目录内禁止重名 */
export function moveLibraryItems(ids, targetParentId = null) {
  const idSet = new Set(ids || []);
  if (!idSet.size) return getLibraryItems();
  let items = getLibraryItems();
  const blocked = new Set();
  for (const id of idSet) {
    const item = items.find((x) => x.id === id);
    if (item?.type === "folder") {
      for (const d of _collectDescendantIds(items, id)) blocked.add(d);
    } else {
      blocked.add(id);
    }
  }
  if (targetParentId && blocked.has(targetParentId)) {
    throw new Error("不能将文件夹移动到自身或其子文件夹内");
  }
  const target = targetParentId ? items.find((x) => x.id === targetParentId) : null;
  if (targetParentId && (!target || target.type !== "folder")) {
    throw new Error("目标文件夹不存在");
  }
  const pending = new Set();
  for (const id of idSet) {
    const item = items.find((x) => x.id === id);
    if (!item) continue;
    const n = String(item.name || "").trim();
    if (pending.has(n) || _nameTaken(items, targetParentId, n, idSet)) {
      throw new Error(`目标目录已存在「${n}」，无法移动`);
    }
    pending.add(n);
  }
  items = items.map((x) =>
    idSet.has(x.id) ? { ...x, parentId: targetParentId || null, updatedAt: _nowIso() } : x
  );
  setLibraryItems(items);
  return items;
}

function _newLibId() {
  return "lib_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

/**
 * 复制到目标文件夹；返回 { items, blobCopies: [{fromId,toId}] } 供前端复制原文件 blob。
 * 文件夹会连同子孙一并复制（新 id）。根项重名时自动加「副本」。
 */
export function copyLibraryItems(ids, targetParentId = null) {
  const idSet = new Set(ids || []);
  if (!idSet.size) return { items: getLibraryItems(), blobCopies: [] };
  let items = getLibraryItems();
  const target = targetParentId ? items.find((x) => x.id === targetParentId) : null;
  if (targetParentId && (!target || target.type !== "folder")) {
    throw new Error("目标文件夹不存在");
  }
  for (const id of idSet) {
    const item = items.find((x) => x.id === id);
    if (item?.type === "folder" && targetParentId) {
      const blocked = _collectDescendantIds(items, id);
      if (blocked.has(targetParentId)) {
        throw new Error("不能将文件夹复制到自身或其子文件夹内");
      }
    }
  }

  const blobCopies = [];
  const created = [];
  const stamp = _nowIso();
  // 虚拟占用：已有项 + 本批新建根项名称
  const virtual = [...items];

  for (const id of idSet) {
    const root = items.find((x) => x.id === id);
    if (!root) continue;
    if (root.type === "file") {
      const nid = _newLibId();
      const name = _allocUniqueName(virtual, targetParentId, root.name);
      const row = {
        ...root,
        id: nid,
        parentId: targetParentId || null,
        name,
        updatedAt: stamp,
      };
      created.push(row);
      virtual.unshift(row);
      if (root.hasBlob) blobCopies.push({ fromId: root.id, toId: nid });
      continue;
    }
    const oldIds = [..._collectDescendantIds(items, root.id)];
    const idMap = new Map();
    for (const oid of oldIds) idMap.set(oid, _newLibId());
    for (const oid of oldIds) {
      const src = items.find((x) => x.id === oid);
      if (!src) continue;
      const nid = idMap.get(oid);
      const parentId =
        oid === root.id
          ? targetParentId || null
          : idMap.get(src.parentId) || (targetParentId || null);
      const name =
        oid === root.id ? _allocUniqueName(virtual, targetParentId, src.name) : src.name;
      const row = {
        ...src,
        id: nid,
        parentId,
        name,
        updatedAt: stamp,
      };
      created.push(row);
      virtual.unshift(row);
      if (src.type === "file" && src.hasBlob) {
        blobCopies.push({ fromId: src.id, toId: nid });
      }
    }
  }

  items = [...created, ...items];
  setLibraryItems(items);
  return { items, blobCopies };
}

/** 文件夹内全部文件（含子文件夹），用于打包分析 */
export function listFolderFiles(folderId, { recursive = true } = {}) {
  const items = getLibraryItems();
  if (!folderId) {
    return items.filter((x) => x.type === "file" && !x.parentId);
  }
  if (!recursive) {
    return items.filter((x) => x.type === "file" && x.parentId === folderId);
  }
  const ids = _collectDescendantIds(items, folderId);
  return items.filter((x) => x.type === "file" && ids.has(x.id) && x.id !== folderId);
}

export function listLibraryFolders() {
  return getLibraryItems()
    .filter((x) => x.type === "folder")
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "zh"));
}

export function listLibraryFiles() {
  return getLibraryItems()
    .filter((x) => x.type === "file")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

/* ---------- 资料库标签 ---------- */

export function getLibraryTags() {
  return load().libraryTags || [];
}

export function setLibraryTags(tags) {
  const data = load();
  data.libraryTags = tags;
  save(data);
}

export function createLibraryTag(name) {
  const n = (name || "").trim();
  if (!n) return null;
  const tags = getLibraryTags();
  if (tags.some((t) => t.name === n)) {
    return tags.find((t) => t.name === n);
  }
  const tag = {
    id: "tag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    name: n,
  };
  tags.push(tag);
  setLibraryTags(tags);
  return tag;
}

export function deleteLibraryTag(tagId) {
  setLibraryTags(getLibraryTags().filter((t) => t.id !== tagId));
  const items = getLibraryItems().map((x) =>
    x.type === "file"
      ? { ...x, tagIds: (x.tagIds || []).filter((id) => id !== tagId) }
      : x
  );
  setLibraryItems(items);
}

export function setLibraryFileTags(fileId, tagIds) {
  const ids = Array.isArray(tagIds) ? [...new Set(tagIds.filter(Boolean))] : [];
  const items = getLibraryItems().map((x) =>
    x.id === fileId ? { ...x, tagIds: ids, updatedAt: _nowIso() } : x
  );
  setLibraryItems(items);
  return items.find((x) => x.id === fileId) || null;
}

/* ---------- JD 匹配度分析记录（按简历） ---------- */

export function getJdMatchRecords(resumeId) {
  const all = load().jdMatchRecords || {};
  const list = all[resumeId] || [];
  return Array.isArray(list) ? list : [];
}

export function addJdMatchRecord(resumeId, record) {
  if (!resumeId) return null;
  const data = load();
  const all = data.jdMatchRecords || {};
  const list = Array.isArray(all[resumeId]) ? [...all[resumeId]] : [];
  const item = {
    id: "jdm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    createdAt: _nowIso(),
    jdPreview: "",
    jdText: "",
    analysis: null,
    ...record,
  };
  list.unshift(item);
  all[resumeId] = list.slice(0, 50);
  data.jdMatchRecords = all;
  save(data);
  return item;
}

export function deleteJdMatchRecord(resumeId, recordId) {
  const data = load();
  const all = data.jdMatchRecords || {};
  const list = (all[resumeId] || []).filter((r) => r.id !== recordId);
  all[resumeId] = list;
  data.jdMatchRecords = all;
  save(data);
  return list;
}

export function updateJdMatchRecord(resumeId, recordId, patch) {
  if (!resumeId || !recordId) return getJdMatchRecords(resumeId);
  const data = load();
  const all = data.jdMatchRecords || {};
  const list = Array.isArray(all[resumeId]) ? [...all[resumeId]] : [];
  const idx = list.findIndex((r) => r.id === recordId);
  if (idx < 0) return list;
  list[idx] = { ...list[idx], ...patch };
  all[resumeId] = list;
  data.jdMatchRecords = all;
  save(data);
  return list;
}
