import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";

export default function HonorsEditor() {
  const { honors, addHonor, updateHonor, removeHonor } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">荣誉奖项</h2>
      <p className="rg-editor-hint">含金量最高的 3-5 项即可，注明级别和年份</p>

      {(honors || []).map((h) => (
        <div key={h.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{h.title || "新奖项"}</span>
            <button type="button" className="btn small mute" onClick={() => removeHonor(h.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field rg-field-wide">
              <span>奖项名称</span>
              <input value={h.title} onChange={(ev) => updateHonor(h.id, { title: ev.target.value })} placeholder="如：ACM 区域赛金牌" />
            </label>
            <label className="rg-editor-field">
              <span>时间</span>
              <input value={h.date} onChange={(ev) => updateHonor(h.id, { date: ev.target.value })} placeholder="2023.06" />
            </label>
            <label className="rg-editor-field">
              <span>备注</span>
              <input value={h.note} onChange={(ev) => updateHonor(h.id, { note: ev.target.value })} placeholder="级别 / 排名 / 颁发方" />
            </label>
          </div>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addHonor}>
        <Plus size={15} /> 添加荣誉奖项
      </button>
    </div>
  );
}
