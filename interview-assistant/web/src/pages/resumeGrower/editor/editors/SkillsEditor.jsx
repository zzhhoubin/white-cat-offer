import React from "react";
import { useResumeStore } from "../store.js";
import RichEditor from "../RichEditor.jsx";

export default function SkillsEditor() {
  const { skillsContent, setSkillsContent } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">专业技能</h2>
      <p className="rg-editor-hint">使用富文本编辑技能描述，支持加粗、斜体和列表</p>
      <div style={{ marginTop: "12px" }}>
        <RichEditor
          content={skillsContent}
          onChange={setSkillsContent}
          placeholder="描述你的专业技能，如：熟练掌握 React、TypeScript..."
        />
      </div>
    </div>
  );
}
