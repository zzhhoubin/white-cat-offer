import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";
import RichEditor from "../RichEditor.jsx";

export default function ProjectsEditor() {
  const { projects, addProject, updateProject, removeProject } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">项目经历</h2>
      <p className="rg-editor-hint">展示 2-4 个核心项目，强调你的角色和量化成果</p>

      {projects.map((p) => (
        <div key={p.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{p.name || "新项目"}</span>
            <button type="button" className="btn small mute" onClick={() => removeProject(p.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field rg-field-wide">
              <span>项目名称</span>
              <input value={p.name} onChange={(ev) => updateProject(p.id, { name: ev.target.value })} placeholder="项目名称" />
            </label>
            <label className="rg-editor-field">
              <span>角色</span>
              <input value={p.role} onChange={(ev) => updateProject(p.id, { role: ev.target.value })} placeholder="前端负责人" />
            </label>
            <label className="rg-editor-field">
              <span>所在公司</span>
              <input value={p.company} onChange={(ev) => updateProject(p.id, { company: ev.target.value })} placeholder="公司名" />
            </label>
            <label className="rg-editor-field">
              <span>开始</span>
              <input value={p.start} onChange={(ev) => updateProject(p.id, { start: ev.target.value })} placeholder="2022.03" />
            </label>
            <label className="rg-editor-field">
              <span>结束</span>
              <input value={p.end} onChange={(ev) => updateProject(p.id, { end: ev.target.value })} placeholder="2022.09" />
            </label>
          </div>
          <div className="rg-editor-subsec">
            <span className="rg-editor-label">项目描述</span>
            <RichEditor
              content={p.description}
              onChange={(html) => updateProject(p.id, { description: html })}
              placeholder="项目背景、你的职责与成果..."
            />
          </div>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addProject}>
        <Plus size={15} /> 添加项目经历
      </button>
    </div>
  );
}
