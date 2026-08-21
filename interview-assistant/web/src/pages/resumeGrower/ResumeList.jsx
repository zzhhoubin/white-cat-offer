import { useRef, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";

export default function ResumeList({ resumes, uploading, status, onUpload, onOpen, onDelete, onCreate }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(file) {
    if (!file) return;
    onUpload(file);
  }

  return (
    <div className="rg-list">
      <div className="rg-entry-row">
        <div
          className={`rg-upload-row${dragOver ? " drag" : ""}`}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div>
            <strong>{uploading ? "上传中…" : "上传简历（PDF）"}</strong>
            <div className="rg-hint">仅支持 PDF · 抽取固定模块后按系统默认模板编排</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <div
          className="rg-upload-row"
          onClick={onCreate}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onCreate();
            }
          }}
        >
          <div>
            <strong>新建/编辑简历</strong>
            <div className="rg-hint">从空白模板开始填写 · 在线编辑并导出 PDF</div>
          </div>
        </div>
      </div>

      {status && <p className="status-line">{status}</p>}

      <div className="rg-table-card">
        <div className="rg-table-head">
          <div>简历名称</div>
          <div>评分</div>
          <div>更新时间</div>
          <div>操作</div>
        </div>
        {resumes.length === 0 ? (
          <div className="rg-empty">
            <strong>还没有简历</strong>
            上传第一份 PDF，开始养成记
          </div>
        ) : (
          resumes.map((r) => (
            <div className="rg-table-row" key={r.id}>
              <div>
                <button type="button" className="rg-name" onClick={() => onOpen(r.id)} disabled={r.analyzing}>
                  {r.name}
                </button>
              </div>
              <div className="rg-score">{r.score == null ? "—" : `${r.score}/110`}</div>
              <div className="rg-meta">{r.updated}</div>
              <div className="rg-row-actions">
                <button
                  type="button"
                  className="btn small mute"
                  disabled={r.analyzing}
                  onClick={() => onOpen(r.id)}
                  title="打开简历"
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  type="button"
                  className="btn small mute"
                  onClick={() => onDelete(r.id)}
                  title="删除简历"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
