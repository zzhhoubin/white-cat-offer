import React from "react";

export const FONTS = [
  { id: "default", label: "系统默认", family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { id: "song", label: "宋体", family: 'SimSun, "Songti SC", "Noto Serif CJK SC", 宋体, serif' },
  { id: "hei", label: "黑体", family: 'SimHei, "Heiti SC", "Microsoft YaHei", 黑体, sans-serif' },
  { id: "kai", label: "楷体", family: 'KaiTi, "Kaiti SC", 楷体, serif' },
  { id: "ming", label: "明体", family: '"Noto Serif CJK SC", "Source Han Serif SC", serif' },
];

export function resolveFontFamily(fontId) {
  const hit = FONTS.find((f) => f.id === fontId);
  return hit?.family || FONTS[0].family;
}

export default function FontPicker({ value, onChange }) {
  return (
    <div className="rg-fp-wrap">
      {FONTS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`rg-fp-item${value === f.id ? " active" : ""}`}
          style={{ fontFamily: f.family }}
          onClick={() => onChange(f.id)}
        >
          <span className="rg-fp-name">{f.label}</span>
          <span className="rg-fp-sample">Aa</span>
        </button>
      ))}
    </div>
  );
}
