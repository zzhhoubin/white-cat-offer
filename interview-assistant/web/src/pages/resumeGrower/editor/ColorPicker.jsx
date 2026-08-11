import React, { useState } from "react";
import { PRESET_COLORS } from "./store.js";

export default function ColorPicker({ value, onChange }) {
  const [custom, setCustom] = useState("");

  return (
    <div className="rg-cp-wrap">
      <div className="rg-cp-swatches">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`rg-cp-swatch${value === c ? " active" : ""}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            title={c}
          />
        ))}
        <label className="rg-cp-swatch rg-cp-custom" title="自定义颜色">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{ opacity: 0, position: "absolute", width: 0, height: 0 }}
          />
          <span style={{ fontSize: "14px", lineHeight: "26px" }}>+</span>
        </label>
      </div>
    </div>
  );
}
