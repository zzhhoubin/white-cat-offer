import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjs from "pdfjs-dist";
import { getResumePdf } from "./pdfStore.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/** 原件只读预览：pdf.js 白底；工具栏默认隐藏，悬停顶部滑出 */
export default function PdfPaper({ resumeId, fileName }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.6);
  const [barOpen, setBarOpen] = useState(false);
  const docRef = useRef(null);
  const hostRef = useRef(null);
  const hideTimer = useRef(null);

  const renderPages = useCallback(async (doc, nextScale) => {
    const host = hostRef.current;
    if (!doc || !host) return;
    host.innerHTML = "";
    const total = doc.numPages;
    setPageCount(total);
    const maxWidth = Math.max(280, (host.clientWidth || 720) - 32);

    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(nextScale, maxWidth / base.width);
      const viewport = page.getViewport({ scale: fit });

      const pageEl = document.createElement("div");
      pageEl.className = "rg-pdf-page";
      const canvas = document.createElement("canvas");
      canvas.className = "rg-pdf-page-img";
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageEl.appendChild(canvas);
      host.appendChild(pageEl);

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let doc = null;

    async function load() {
      setLoading(true);
      setError("");
      setPageCount(0);
      if (hostRef.current) hostRef.current.innerHTML = "";
      try {
        const blob = await getResumePdf(resumeId);
        if (cancelled) return;
        if (!blob) {
          setError("未找到原 PDF，请重新上传。");
          return;
        }
        const data = await blob.arrayBuffer();
        if (cancelled) return;
        doc = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        await renderPages(doc, scale);
      } catch (e) {
        if (!cancelled) setError(e.message || "加载原 PDF 失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      docRef.current = null;
      if (doc) {
        try { doc.destroy(); } catch { /* ignore */ }
      }
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
    // 仅随简历切换重新加载；缩放另 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc || loading) return;
    let cancelled = false;
    (async () => {
      try {
        await renderPages(doc, scale);
      } catch {
        if (!cancelled) { /* ignore redraw errors */ }
      }
    })();
    return () => { cancelled = true; };
  }, [scale, loading, renderPages]);

  function openBar() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setBarOpen(true);
  }

  function scheduleHideBar() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarOpen(false), 400);
  }

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (error) return <div className="rg-pdf-empty">{error}</div>;

  return (
    <div
      className={`rg-pdf-wrap${barOpen ? " is-bar-open" : ""}`}
      onMouseLeave={scheduleHideBar}
    >
      <div
        className="rg-pdf-hotzone"
        onMouseEnter={openBar}
        aria-hidden="true"
      />
      <div
        className="rg-pdf-floatbar"
        onMouseEnter={openBar}
        onMouseLeave={scheduleHideBar}
        role="toolbar"
        aria-label="预览工具"
      >
        <button type="button" className="rg-pdf-tool-btn" disabled={scale <= 0.6}
          onClick={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))}
          title="缩小">−</button>
        <span className="rg-pdf-zoom-label">{Math.round(scale * 100)}%</span>
        <button type="button" className="rg-pdf-tool-btn" disabled={scale >= 2}
          onClick={() => setScale((s) => Math.min(2, +(s + 0.15).toFixed(2)))}
          title="放大">+</button>
        <span className="rg-pdf-page-label">
          {pageCount > 0 ? `${pageCount} 页` : "—"}
        </span>
      </div>

      {loading && <div className="rg-pdf-empty">正在加载原件…</div>}
      <div
        ref={hostRef}
        className="rg-pdf-pages"
        aria-label={fileName || "简历预览"}
        hidden={loading}
      />
    </div>
  );
}
