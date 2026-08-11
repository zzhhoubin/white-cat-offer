import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";

export default function EducationEditor() {
  const { education, addEducation, updateEducation, removeEducation } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">教育经历</h2>

      {education.map((e) => (
        <div key={e.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{e.school || "新教育经历"}</span>
            <button type="button" className="btn small mute" onClick={() => removeEducation(e.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field rg-field-wide">
              <span>学校</span>
              <input value={e.school} onChange={(ev) => updateEducation(e.id, { school: ev.target.value })} placeholder="大学名称" />
            </label>
            <label className="rg-editor-field">
              <span>学位</span>
              <input value={e.degree} onChange={(ev) => updateEducation(e.id, { degree: ev.target.value })} placeholder="本科 / 硕士" />
            </label>
            <label className="rg-editor-field">
              <span>专业</span>
              <input value={e.major} onChange={(ev) => updateEducation(e.id, { major: ev.target.value })} placeholder="计算机科学" />
            </label>
            <label className="rg-editor-field">
              <span>开始</span>
              <input value={e.start} onChange={(ev) => updateEducation(e.id, { start: ev.target.value })} placeholder="2016.09" />
            </label>
            <label className="rg-editor-field">
              <span>结束</span>
              <input value={e.end} onChange={(ev) => updateEducation(e.id, { end: ev.target.value })} placeholder="2020.06" />
            </label>
          </div>
          <label className="rg-editor-field rg-field-wide">
            <span>补充信息（GPA、主修课程等）</span>
            <input value={e.extras} onChange={(ev) => updateEducation(e.id, { extras: ev.target.value })} placeholder="如：GPA 3.8/4.0，主修课程：数据结构、算法设计" />
          </label>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addEducation}>
        <Plus size={15} /> 添加教育经历
      </button>
    </div>
  );
}
