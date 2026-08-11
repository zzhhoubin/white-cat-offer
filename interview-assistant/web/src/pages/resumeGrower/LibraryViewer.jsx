import { useEffect, useRef, useState } from "react";
import { X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import mammoth from "mammoth";
import { getLibraryFileBlob } from "./libraryFileStore.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

function extOf(name = "") {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 极简 Markdown → HTML（标题/粗体/代码/换行） */
function simpleMarkdownToHtml(md) {
  let html = escapeHtml(md);
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\n/g, "<br/>");
  return html;
}

export default function LibraryViewer({ item, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState(""); // pdf | html | text | note
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [pdfDoc, setPdfDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [blobUrl, setBlobUrl] = useState("");
  const canvasRef = useRef(null);

  const ext = extOf(item?.name);

  useEffect(() => {
    let cancelled = false;
    let url = "";

    async function load() {
      setLoading(true);
      setError("");
      setHtml("");
      setText("");
      setNote("");
      setPdfDoc(null);
      setPage(1);
      setPageCount(0);
      try {
        const blob = await getLibraryFileBlob(item.id);
        if (cancelled) return;

        if (!blob) {
          // 旧数据无原文件：尽量用解析文本
          const fallback = (item.content || "").trim();
          if (fallback) {
            if (ext === "md" || ext === "markdown") {
              setMode("html");
              setHtml(simpleMarkdownToHtml(fallback));
              setNote("当前为历史记录，仅显示已解析文本。重新上传后可完整预览。");
            } else {
              setMode("text");
              setText(fallback);
              setNote("当前为历史记录，仅显示已解析文本。重新上传后可完整预览。");
            }
          } else {
            setError("未找到原文件，请重新上传后再查看。");
          }
          return;
        }

        url = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(url);

        if (ext === "pdf") {
          const data = await blob.arrayBuffer();
          const doc = await pdfjs.getDocument({ data }).promise;
          if (cancelled) return;
          setPdfDoc(doc);
          setPageCount(doc.numPages);
          setPage(1);
          setMode("pdf");
        } else if (ext === "docx") {
          const data = await blob.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer: data });
          if (cancelled) return;
          setHtml(result.value || "<p>（空文档）</p>");
          setMode("html");
        } else if (ext === "doc") {
          const fallback = (item.content || "").trim();
          setMode("text");
          setText(fallback || "暂不支持旧版 .doc 版式预览，请转为 .docx 后重新上传。");
          setNote("建议转换为 .docx 以获得更好预览效果。");
        } else if (ext === "md" || ext === "markdown") {
          const raw = await blob.text();
          if (cancelled) return;
          setHtml(simpleMarkdownToHtml(raw));
          setMode("html");
        } else if (ext === "txt" || ext === "text") {
          const raw = await blob.text();
          if (cancelled) return;
          setText(raw);
          setMode("text");
        } else if (ext === "ppt" || ext === "pptx") {
          const fallback = (item.content || "").trim();
          setMode("text");
          setText(
            fallback ||
              "暂不支持 PPT 版式预览。若上传时解析成功，此处会显示提取正文；也可点击「下载」用本地软件打开。"
          );
          setNote("PPT 版式预览后续支持；可先下载原文件查看。");
        } else {
          const fallback = (item.content || "").trim();
          setMode("text");
          setText(fallback || "暂不支持该格式在线预览，请下载后查看。");
        }
      } catch (e) {
        if (!cancelled) setError(e.message || "打开失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item?.id, item?.name, item?.content, ext]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!pdfDoc || mode !== "pdf" || !canvasRef.current) return;
      const p = await pdfDoc.getPage(page);
      if (cancelled) return;
      const viewport = p.getViewport({ scale: 1.25 });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await p.render({ canvasContext: ctx, viewport }).promise;
    }
    renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, page, mode]);

  function download() {
    if (!blobUrl) {
      onClose?.();
      return;
    }
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = item.name || "download";
    a.click();
  }

  return (
    <div className="lib-viewer-mask" onClick={onClose}>
      <div className="lib-viewer" onClick={(e) => e.stopPropagation()}>
        <header className="lib-viewer-hd">
          <strong className="lib-viewer-title" title={item.name}>
            {item.name}
          </strong>
          <div className="lib-viewer-actions">
            {mode === "pdf" && pageCount > 0 && (
              <span className="lib-viewer-pager">
                <button
                  type="button"
                  className="btn small"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} />
                </button>
                <span>
                  {page} / {pageCount}
                </span>
                <button
                  type="button"
                  className="btn small"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <ChevronRight size={14} />
                </button>
              </span>
            )}
            {blobUrl && (
              <button type="button" className="btn small" onClick={download}>
                <Download size={14} /> 下载
              </button>
            )}
            <button type="button" className="btn small" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="lib-viewer-body">
          {loading && <p className="muted">加载中…</p>}
          {!loading && error && <p className="status-line">{error}</p>}
          {!loading && !error && note && <p className="lib-viewer-note">{note}</p>}
          {!loading && !error && mode === "pdf" && (
            <div className="lib-viewer-pdf">
              <canvas ref={canvasRef} />
            </div>
          )}
          {!loading && !error && mode === "html" && (
            <div className="lib-viewer-html" dangerouslySetInnerHTML={{ __html: html }} />
          )}
          {!loading && !error && mode === "text" && (
            <pre className="lib-viewer-text">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
