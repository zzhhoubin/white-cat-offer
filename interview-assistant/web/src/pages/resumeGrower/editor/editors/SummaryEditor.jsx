import React from "react";

/** 个人总结编辑 */
export default function SummaryEditor({ bullets, onChange }) {
  function setBullet(i, val) {
    const next = [...bullets];
    next[i] = val;
    onChange(next.filter(Boolean));
  }

  function add() {
    onChange([...bullets, ""]);
  }

  function remove(i) {
    const next = bullets.filter((_, idx) => idx !== i);
    onChange(next);
  }

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">个人总结</h2>
      <p className="rg-editor-hint">3-5 条核心亮点，每条一句话，体现差异化竞争力</p>
      {(bullets || []).map((b, i) => (
        <div key={i} className="rg-editor-bullet-row">
          <span className="rg-bullet-dot">●</span>
          <input
            value={b}
            onChange={(e) => setBullet(i, e.target.value)}
            placeholder={`亮点 ${i + 1}：具体成就 + 量化数据`}
          />
          <button type="button" className="btn small mute" onClick={() => remove(i)} title="删除">
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={add}>
        + 添加亮点
      </button>
    </div>
  );
}
