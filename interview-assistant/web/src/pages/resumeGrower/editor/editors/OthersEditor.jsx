import React from "react";
import { useResumeStore } from "../store.js";
import RichEditor from "../RichEditor.jsx";

export default function OthersEditor() {
  const { othersContent, setOthersContent } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">其他</h2>
      <p className="rg-editor-hint">自我评价、兴趣爱好、志愿服务等自由内容</p>
      <div style={{ marginTop: "12px" }}>
        <RichEditor
          content={othersContent || ""}
          onChange={setOthersContent}
          placeholder="补充其他想展示的信息…"
        />
      </div>
    </div>
  );
}
