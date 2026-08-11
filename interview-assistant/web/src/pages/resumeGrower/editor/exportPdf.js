import html2canvas from "html2canvas";
import jsPDF from "jspdf";

/**
 * 导出 PDF：按预览分页（.resume-preview-page）逐页截图 → jsPDF A4
 * 与所见分页一致，避免长图硬切导致半截字/黑缝。
 */
export async function exportResumePdf(filename) {
  const pages = Array.from(document.querySelectorAll(".resume-preview-page"));
  if (!pages.length) {
    alert("未找到预览内容，请先填写简历信息");
    return;
  }

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const clones = [];

  try {
    for (let i = 0; i < pages.length; i += 1) {
      const el = pages[i];
      const clone = el.cloneNode(true);
      clone.style.transform = "none";
      clone.style.position = "absolute";
      clone.style.left = "-9999px";
      clone.style.top = "0";
      clone.style.boxShadow = "none";
      clone.style.margin = "0";
      document.body.appendChild(clone);
      clones.push(clone);

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        width: el.offsetWidth,
        height: el.offsetHeight,
        windowWidth: el.offsetWidth,
        windowHeight: el.offsetHeight,
      });

      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const imgWidth = pageWidth;
      const imgHeight = Math.min(pageHeight, (canvas.height * pageWidth) / canvas.width);

      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, imgWidth, imgHeight);
    }

    pdf.save(`${filename || "简历"}.pdf`);
  } catch (err) {
    console.error("PDF 导出失败:", err);
    alert("PDF 导出失败：" + err.message);
  } finally {
    clones.forEach((c) => {
      if (c.parentNode) c.parentNode.removeChild(c);
    });
  }
}
