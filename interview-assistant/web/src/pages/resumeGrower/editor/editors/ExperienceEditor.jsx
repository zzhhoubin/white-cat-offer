import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";
import RichEditor from "../RichEditor.jsx";

export default function ExperienceEditor() {
  const { experience, addExperience, updateExperience, removeExperience } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">工作经历</h2>
      <p className="rg-editor-hint">使用 STAR 原则描述每段工作经历</p>

      {experience.map((e) => (
        <div key={e.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{e.company || "新工作经历"}</span>
            <button type="button" className="btn small mute" onClick={() => removeExperience(e.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field">
              <span>公司</span>
              <input value={e.company} onChange={(ev) => updateExperience(e.id, { company: ev.target.value })} placeholder="公司名称" />
            </label>
            <label className="rg-editor-field">
              <span>职位</span>
              <input value={e.title} onChange={(ev) => updateExperience(e.id, { title: ev.target.value })} placeholder="前端工程师" />
            </label>
            <label className="rg-editor-field">
              <span>开始</span>
              <input value={e.start} onChange={(ev) => updateExperience(e.id, { start: ev.target.value })} placeholder="2020.06" />
            </label>
            <label className="rg-editor-field">
              <span>结束</span>
              <input value={e.end} onChange={(ev) => updateExperience(e.id, { end: ev.target.value })} placeholder="至今 / 2023.12" />
            </label>
          </div>
          <div className="rg-editor-subsec">
            <span className="rg-editor-label">工作描述</span>
            <RichEditor
              content={e.description}
              onChange={(html) => updateExperience(e.id, { description: html })}
              placeholder="使用 STAR 原则描述工作内容与成果..."
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addExperience}>
        <Plus size={15} /> 添加工作经历
      </button>
    </div>
  );
}
