import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";

const LEVELS = ["母语", "流利", "熟练", "一般", "入门"];

export default function LanguagesEditor() {
  const { languages, addLanguage, updateLanguage, removeLanguage } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">语言能力</h2>
      <p className="rg-editor-hint">可填写掌握程度及对应语言证书</p>

      {(languages || []).map((l) => (
        <div key={l.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{l.name || "新语言"}</span>
            <button type="button" className="btn small mute" onClick={() => removeLanguage(l.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field">
              <span>语言</span>
              <input value={l.name} onChange={(ev) => updateLanguage(l.id, { name: ev.target.value })} placeholder="如：英语" />
            </label>
            <label className="rg-editor-field">
              <span>掌握程度</span>
              <select value={l.level || "熟练"} onChange={(ev) => updateLanguage(l.id, { level: ev.target.value })}>
                {LEVELS.map((lv) => (
                  <option key={lv} value={lv}>{lv}</option>
                ))}
              </select>
            </label>
            <label className="rg-editor-field">
              <span>相关证书</span>
              <input value={l.cert} onChange={(ev) => updateLanguage(l.id, { cert: ev.target.value })} placeholder="如：CET-6 / 雅思 7.0" />
            </label>
            <label className="rg-editor-field rg-field-wide">
              <span>补充说明</span>
              <input value={l.note} onChange={(ev) => updateLanguage(l.id, { note: ev.target.value })} placeholder="可空" />
            </label>
          </div>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addLanguage}>
        <Plus size={15} /> 添加语言
      </button>
    </div>
  );
}
