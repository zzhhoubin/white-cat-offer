import React from "react";
import { useResumeStore } from "../store.js";
import RichEditor from "../RichEditor.jsx";

export default function CustomEditor({ moduleId }) {
  const mod = useResumeStore((s) => s.modules.find((m) => m.id === moduleId));
  const content = useResumeStore((s) => s.customData[moduleId] || "");
  const updateCustomData = useResumeStore((s) => s.updateCustomData);

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">{mod?.label || "自定义模块"}</h2>
      <p className="rg-editor-hint">自定义模块内容，支持加粗、斜体和列表</p>
      <div style={{ marginTop: "12px" }}>
        <RichEditor
          content={content}
          onChange={(html) => updateCustomData(moduleId, html)}
          placeholder="输入自定义模块的内容..."
        />
      </div>
    </div>
  );
}
