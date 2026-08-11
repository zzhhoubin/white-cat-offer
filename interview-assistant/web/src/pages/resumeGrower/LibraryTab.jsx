import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, FileText, ChevronUp, ArrowUp } from "lucide-react";
import {
  addLibraryFile,
  copyLibraryItems,
  createLibraryFolder,
  deleteLibraryItems,
  getLibraryItem,
  getLibraryItems,
  getLibraryPath,
  getProjectPacks,
  listFolderFiles,
  listLibraryChildren,
  listLibraryFolders,
  moveLibraryItems,
  renameLibraryItem,
  upsertProjectPack,
} from "./storage.js";
import { deleteLibraryFileBlobs, getLibraryFileBlob, putLibraryFileBlob } from "./libraryFileStore.js";
import LibraryViewer from "./LibraryViewer.jsx";
import { api } from "../../api.js";

function formatSize(n) {
  const size = Number(n) || 0;
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(item) {
  if (item.type === "folder") return "文件夹";
  const name = item.name || "";
  const ext = name.includes(".") ? name.split(".").pop().toUpperCase() : "";
  return ext ? `${ext} 文件` : "文件";
}

function emptyAnalysis() {
  return {
    status: "idle",
    resume_desc: null,
    oral_script: "",
    deep_questions: [],
    error: "",
  };
}

function packIdForFolder(folderId) {
  return `pack_folder_${folderId}`;
}

export default function LibraryTab({ onStatus }) {
  const fileRef = useRef(null);
  const [parentId, setParentId] = useState(null);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [sortAsc, setSortAsc] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [viewerItem, setViewerItem] = useState(null);
  const [generatingId, setGeneratingId] = useState("");
  const [cardPreview, setCardPreview] = useState(null);

  const items = useMemo(() => {
    const list = listLibraryChildren(parentId);
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const cmp = String(a.updatedAt || "").localeCompare(String(b.updatedAt || ""));
      return sortAsc ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, tick, sortAsc]);

  const crumbs = useMemo(() => (parentId ? getLibraryPath(parentId) : []), [parentId, tick]);
  const folders = useMemo(() => listLibraryFolders(), [tick]);
  const projectCards = useMemo(() => {
    return getProjectPacks().filter((p) => String(p.id || "").startsWith("pack_folder_"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const selectedFolderId = useMemo(() => {
    if (selected.size === 1) {
      const id = [...selected][0];
      const item = getLibraryItem(id);
      if (item?.type === "folder") return id;
    }
    return parentId || null;
  }, [selected, parentId, tick]);

  function refresh() {
    setTick((n) => n + 1);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      clearSelection();
      return;
    }
    setSelected(new Set(items.map((x) => x.id)));
  }

  function handleCreateFolder() {
    let draft = "新建项目文件夹";
    while (true) {
      const name = window.prompt("文件夹名称（建议用项目名）", draft);
      if (name == null) return;
      draft = name;
      try {
        const folder = createLibraryFolder(name, parentId);
        refresh();
        clearSelection();
        onStatus?.(`已创建文件夹：${folder.name}`);
        return;
      } catch (e) {
        window.alert(e.message || "同目录下不能重名，请更换名称");
      }
    }
  }

  async function handleUploadFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    let ok = 0;
    let fail = 0;
    let dup = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      onStatus?.(`正在上传 ${i + 1}/${files.length}：${file.name}`);
      let content = "";
      try {
        const data = await api.extractMaterial(file);
        content = data.text || "";
      } catch {
        /* 解析失败仍保存文件元数据与原文件 */
      }
      let meta;
      try {
        meta = addLibraryFile({
          name: file.name,
          size: file.size,
          mime: file.type || "",
          content,
          parentId,
          hasBlob: true,
        });
      } catch (e) {
        dup += 1;
        window.alert(e.message || `「${file.name}」与同目录文件重名，已跳过`);
        continue;
      }
      try {
        await putLibraryFileBlob(meta.id, file);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    refresh();
    clearSelection();
    const parts = [`成功 ${ok}`];
    if (dup) parts.push(`重名跳过 ${dup}`);
    if (fail) parts.push(`缓存失败 ${fail}`);
    onStatus?.(
      ok && !dup && !fail
        ? `已上传 ${ok} 个文件。将同项目资料放入同一文件夹后，可一键生成项目卡`
        : `上传：${parts.join("，")}`
    );
  }

  function handleRename() {
    if (selected.size !== 1) {
      onStatus?.("请先选中一个文件或文件夹再重命名");
      return;
    }
    const id = [...selected][0];
    const item = getLibraryItem(id);
    if (!item) return;
    let draft = item.name;
    while (true) {
      const name = window.prompt("重命名（同目录不能重名）", draft);
      if (name == null) return;
      draft = name;
      if (!String(name).trim()) {
        window.alert("名称不能为空");
        continue;
      }
      try {
        renameLibraryItem(id, name);
        refresh();
        onStatus?.("已重命名");
        return;
      } catch (e) {
        window.alert(e.message || "同目录下不能重名，请更换名称");
      }
    }
  }

  async function handleDelete() {
    if (!selected.size) {
      onStatus?.("请先勾选要删除的项");
      return;
    }
    if (!window.confirm(`确定删除选中的 ${selected.size} 项？文件夹将连同其内容一并删除。`)) return;
    const before = getLibraryItems();
    const idSet = new Set(selected);
    const removeIds = [];
    for (const id of idSet) {
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        if (removeIds.includes(cur)) continue;
        removeIds.push(cur);
        before.filter((x) => x.parentId === cur).forEach((c) => stack.push(c.id));
      }
    }
    deleteLibraryItems([...selected]);
    await deleteLibraryFileBlobs(removeIds);
    refresh();
    clearSelection();
    onStatus?.("已删除");
  }

  function openMove() {
    if (!selected.size) {
      onStatus?.("请先勾选要移动的项");
      return;
    }
    setMoveTarget("");
    setMoveOpen(true);
  }

  function openCopy() {
    if (!selected.size) {
      onStatus?.("请先勾选要复制的项");
      return;
    }
    setMoveTarget("");
    setCopyOpen(true);
  }

  function confirmMove() {
    try {
      const target = moveTarget || null;
      moveLibraryItems([...selected], target);
      setMoveOpen(false);
      refresh();
      clearSelection();
      onStatus?.("已移动");
    } catch (e) {
      onStatus?.(e.message || "移动失败");
    }
  }

  async function confirmCopy() {
    try {
      const target = moveTarget || null;
      const { blobCopies } = copyLibraryItems([...selected], target);
      for (const { fromId, toId } of blobCopies) {
        try {
          const blob = await getLibraryFileBlob(fromId);
          if (blob) await putLibraryFileBlob(toId, blob);
        } catch {
          /* blob 复制失败不影响元数据 */
        }
      }
      setCopyOpen(false);
      refresh();
      clearSelection();
      onStatus?.("已复制");
    } catch (e) {
      onStatus?.(e.message || "复制失败");
    }
  }

  async function generateProjectCard(folderId) {
    if (!folderId || generatingId) return;
    const folder = getLibraryItem(folderId);
    if (!folder || folder.type !== "folder") {
      onStatus?.("请选择或进入一个项目文件夹后再生成项目卡");
      return;
    }
    const files = listFolderFiles(folderId, { recursive: true });
    if (!files.length) {
      onStatus?.("文件夹内无资料，请先上传后再打包生成");
      return;
    }
    setGeneratingId(folderId);
    const packId = packIdForFolder(folderId);
    upsertProjectPack({
      id: packId,
      name: folder.name,
      folderId,
      materialIds: files.map((f) => f.id),
      analysis: { ...emptyAnalysis(), status: "running" },
      updated: new Date().toISOString().slice(0, 10),
    });
    refresh();
    try {
      const mats = files.map((m) => ({
        name: m.name,
        content: String(m.content || "").slice(0, 20000),
      }));
      if (mats.some((m) => !String(m.content || "").trim())) {
        onStatus?.("部分资料尚未解析出正文，项目卡可能偏弱");
      }
      const data = await api.analyzeProjectPack({
        pack_name: folder.name,
        resume_project: null,
        materials: mats,
      });
      const analysis = { status: "done", ...(data.analysis || {}), error: "" };
      upsertProjectPack({
        id: packId,
        name: folder.name,
        folderId,
        materialIds: files.map((f) => f.id),
        analysis,
        updated: new Date().toISOString().slice(0, 10),
      });
      const rd = analysis.resume_desc || {};
      try {
        await api.syncResumeProjects({
          projects: [
            {
              name: rd.name || folder.name,
              role: rd.role || "",
              intro: rd.intro || "",
              responsibilities: rd.responsibilities || [],
              achievements: rd.achievements || [],
              bullets: rd.bullets || [],
            },
          ],
          source_resume_id: packId,
          replace: true,
        });
      } catch {
        /* 云端同步失败不影响本地项目卡 */
      }
      refresh();
      onStatus?.(`已生成项目卡「${rd.name || folder.name}」`);
    } catch (err) {
      upsertProjectPack({
        id: packId,
        name: folder.name,
        folderId,
        materialIds: files.map((f) => f.id),
        analysis: { ...emptyAnalysis(), status: "error", error: err.message || "生成失败" },
        updated: new Date().toISOString().slice(0, 10),
      });
      refresh();
      onStatus?.("生成失败：" + (err.message || ""));
    } finally {
      setGeneratingId("");
    }
  }

  function handleGenerateClick() {
    if (!selectedFolderId) {
      onStatus?.("请先创建并选中（或进入）一个项目文件夹");
      return;
    }
    void generateProjectCard(selectedFolderId);
  }

  function enterFolder(id) {
    setParentId(id);
    clearSelection();
  }

  function goUp() {
    if (!parentId) return;
    const cur = getLibraryItem(parentId);
    setParentId(cur?.parentId || null);
    clearSelection();
  }

  const allChecked = items.length > 0 && selected.size === items.length;
  const canGenerate = Boolean(selectedFolderId) && !generatingId;

  function renderTargetModal({ title, onConfirm, onClose }) {
    return (
      <div className="lib-modal-mask" onClick={onClose}>
        <div className="lib-modal card" onClick={(e) => e.stopPropagation()}>
          <h3>{title}</h3>
          <label className="lib-move-field">
            <span>目标文件夹</span>
            <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
              <option value="">全部文件（根目录）</option>
              {folders
                .filter((f) => !selected.has(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {getLibraryPath(f.id)
                      .map((p) => p.name)
                      .join(" / ")}
                  </option>
                ))}
            </select>
          </label>
          <div className="lib-modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn primary" onClick={onConfirm}>
              确定
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lib-page">
      <p className="lib-flow-hint muted">
        流程：上传资料 → 按项目放入文件夹（资料打包）→ 一键生成项目卡。不支持对单一文件分析。
      </p>

      <div className="lib-toolbar">
        <div className="lib-toolbar-left">
          <button type="button" className="btn small primary" onClick={handleCreateFolder}>
            新建文件夹
          </button>
          <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
            上传
          </button>
          <button type="button" className="btn small" disabled={!selected.size} onClick={openMove}>
            移动
          </button>
          <button type="button" className="btn small" disabled={!selected.size} onClick={openCopy}>
            复制
          </button>
          <button type="button" className="btn small" disabled={selected.size !== 1} onClick={handleRename}>
            重命名
          </button>
          <button type="button" className="btn small danger" disabled={!selected.size} onClick={handleDelete}>
            删除
          </button>
          <button
            type="button"
            className="btn small primary"
            disabled={!canGenerate}
            onClick={handleGenerateClick}
            title="对当前项目文件夹内全部资料打包分析，生成项目卡"
          >
            {generatingId ? "生成中…" : "一键生成项目卡"}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.doc,.docx,.txt,.md,.markdown,.ppt,.pptx,.xls,.xlsx,.csv"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) void handleUploadFiles(files);
          }}
        />
      </div>

      <div className="lib-crumbs">
        <button type="button" className="lib-crumb" onClick={() => { setParentId(null); clearSelection(); }}>
          全部文件
        </button>
        {crumbs.map((c) => (
          <span key={c.id} className="lib-crumb-seg">
            <span className="lib-crumb-sep">/</span>
            <button type="button" className="lib-crumb" onClick={() => enterFolder(c.id)}>
              {c.name}
            </button>
          </span>
        ))}
        {parentId && (
          <button type="button" className="btn small lib-up" onClick={goUp} title="返回上级">
            <ArrowUp size={14} /> 上级
          </button>
        )}
      </div>

      <div className="lib-table-wrap card">
        <table className="lib-table">
          <thead>
            <tr>
              <th className="lib-col-check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全选" />
              </th>
              <th className="lib-col-name">文件名</th>
              <th className="lib-col-size">大小</th>
              <th className="lib-col-type">类型</th>
              <th className="lib-col-time">
                <button type="button" className="lib-sort" onClick={() => setSortAsc((v) => !v)}>
                  修改时间
                  <ChevronUp size={14} className={sortAsc ? "" : "flip"} />
                </button>
              </th>
              <th className="lib-col-act">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="lib-empty">
                  当前目录为空。请新建项目文件夹并上传 PDF / Word / PPT / Excel / Markdown 等资料。
                </td>
              </tr>
            )}
            {items.map((item) => {
              const pack = item.type === "folder" ? getProjectPacks().find((p) => p.id === packIdForFolder(item.id)) : null;
              return (
                <tr key={item.id} className={selected.has(item.id) ? "selected" : ""}>
                  <td className="lib-col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      aria-label={`选择 ${item.name}`}
                    />
                  </td>
                  <td className="lib-col-name">
                    <button
                      type="button"
                      className="lib-name-btn"
                      onClick={() => {
                        if (item.type === "folder") enterFolder(item.id);
                        else setViewerItem(item);
                      }}
                    >
                      {item.type === "folder" ? (
                        <Folder size={18} className="lib-icon folder" />
                      ) : (
                        <FileText size={18} className="lib-icon file" />
                      )}
                      <span className={item.type === "file" ? "lib-file-link" : ""}>{item.name}</span>
                    </button>
                  </td>
                  <td className="lib-col-size">{item.type === "folder" ? "-" : formatSize(item.size)}</td>
                  <td className="lib-col-type">{fileTypeLabel(item)}</td>
                  <td className="lib-col-time">{item.updatedAt || "-"}</td>
                  <td className="lib-col-act">
                    {item.type === "folder" && (
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={Boolean(generatingId)}
                        onClick={() => void generateProjectCard(item.id)}
                      >
                        {generatingId === item.id
                          ? "生成中…"
                          : pack?.analysis?.status === "done"
                            ? "重新生成项目卡"
                            : "一键生成项目卡"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card lib-cards-section">
        <header className="lib-cards-hd">
          <h3>项目卡</h3>
          <span className="muted">由项目文件夹打包分析生成（{projectCards.length}）</span>
        </header>
        {!projectCards.length && (
          <p className="muted">暂无项目卡。将同项目资料放入同一文件夹后，点击「一键生成项目卡」。</p>
        )}
        <div className="lib-cards-grid">
          {projectCards.map((p) => {
            const a = p.analysis || {};
            const rd = a.resume_desc || {};
            const statusLabel =
              a.status === "done"
                ? "已完成"
                : a.status === "running"
                  ? "生成中"
                  : a.status === "error"
                    ? "失败"
                    : "草稿";
            const statusClass =
              a.status === "done"
                ? "ok"
                : a.status === "running"
                  ? "run"
                  : a.status === "error"
                    ? "err"
                    : "idle";
            const duties = (rd.responsibilities || []).slice(0, 2);
            return (
              <article
                key={p.id}
                className={`lib-proj-card status-${statusClass}`}
                onClick={() => {
                  if (a.status === "done") {
                    setCardPreview({ packId: p.id, name: rd.name || p.name, analysis: a });
                  }
                }}
              >
                <div className="lib-proj-card-top">
                  <span className={`lib-proj-badge ${statusClass}`}>{statusLabel}</span>
                  <span className="lib-proj-count">{(p.materialIds || []).length} 份资料</span>
                </div>
                <h4 className="lib-proj-title">{rd.name || p.name}</h4>
                <p className="lib-proj-role">{rd.role || "未标注角色"}</p>
                {a.status === "error" && <p className="lib-proj-error">{a.error}</p>}
                {a.status === "done" && (
                  <>
                    <p className="lib-proj-intro">
                      {(rd.intro || "暂无简介").slice(0, 96)}
                      {(rd.intro || "").length > 96 ? "…" : ""}
                    </p>
                    {duties.length > 0 && (
                      <ul className="lib-proj-bullets">
                        {duties.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {a.status === "running" && <p className="lib-proj-intro">正在打包分析…</p>}
                <div className="lib-proj-card-ft">
                  <span className="lib-proj-updated">{p.updated || ""}</span>
                  {a.status === "done" && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardPreview({ packId: p.id, name: rd.name || p.name, analysis: a });
                      }}
                    >
                      查看详情
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {moveOpen &&
        renderTargetModal({
          title: "移动到",
          onConfirm: confirmMove,
          onClose: () => setMoveOpen(false),
        })}

      {copyOpen &&
        renderTargetModal({
          title: "复制到",
          onConfirm: () => void confirmCopy(),
          onClose: () => setCopyOpen(false),
        })}

      {cardPreview && (
        <div className="lib-modal-mask" onClick={() => setCardPreview(null)}>
          <div className="lib-modal card lib-card-preview" onClick={(e) => e.stopPropagation()}>
            <h3>{cardPreview.name}</h3>
            {cardPreview.analysis?.resume_desc && (
              <div className="rg-pack-result">
                <p>{cardPreview.analysis.resume_desc.intro}</p>
                <h5>职责</h5>
                <ul>
                  {(cardPreview.analysis.resume_desc.responsibilities || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                <h5>业绩</h5>
                <ul>
                  {(cardPreview.analysis.resume_desc.achievements || []).map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                {cardPreview.analysis.oral_script && (
                  <>
                    <h5>口头介绍</h5>
                    <p style={{ whiteSpace: "pre-wrap" }}>{cardPreview.analysis.oral_script}</p>
                  </>
                )}
              </div>
            )}
            <div className="lib-modal-actions">
              <button type="button" className="btn primary" onClick={() => setCardPreview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {viewerItem && <LibraryViewer item={viewerItem} onClose={() => setViewerItem(null)} />}
    </div>
  );
}
