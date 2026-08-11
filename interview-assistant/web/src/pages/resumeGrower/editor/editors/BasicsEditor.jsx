import React, { useRef } from "react";
import { User, Mail, Phone, MapPin, Globe, Calendar, Briefcase } from "lucide-react";
import { useResumeStore } from "../store.js";

export default function BasicsEditor() {
  const { basics, avatarUrl, updateBasics, setAvatarUrl } = useResumeStore();
  const fileRef = useRef(null);

  function handleAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(reader.result);
    reader.readAsDataURL(file);
  }

  const fields = [
    { key: "name", label: "姓名", placeholder: "你的姓名", icon: User },
    { key: "title", label: "职位/求职意向", placeholder: "前端工程师", icon: null },
    { key: "email", label: "邮箱", placeholder: "you@example.com", icon: Mail },
    { key: "phone", label: "电话", placeholder: "138xxxx", icon: Phone },
    { key: "status", label: "状态", placeholder: "在职 · 5年经验", icon: Briefcase },
    { key: "location", label: "所在地", placeholder: "北京", icon: MapPin },
    { key: "website", label: "个人网站", placeholder: "https://...", icon: Globe },
    { key: "birthday", label: "生日", placeholder: "1995-06", icon: Calendar },
  ];

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">基本信息</h2>

      {/* 头像上传 */}
      <div className="rg-editor-subsec">
        <span className="rg-editor-label">头像</span>
        <div className="rg-avatar-zone" onClick={() => fileRef.current?.click()}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="avatar" className="rg-avatar-preview" />
          ) : (
            <div className="rg-avatar-placeholder">
              <User size={28} />
              <span>点击上传头像</span>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatar} />
        </div>
      </div>

      {/* 字段表单 */}
      <div className="rg-editor-grid">
        {fields.map((f) => {
          const Icon = f.icon;
          return (
            <label key={f.key} className={`rg-editor-field${f.key === "name" || f.key === "title" ? " rg-field-half" : f.key === "website" ? " rg-field-wide" : ""}`}>
              <span>{f.label}</span>
              <div className="rg-field-input-wrap">
                {Icon && <Icon size={14} className="rg-field-icon" />}
                <input
                  value={basics[f.key] || ""}
                  onChange={(e) => updateBasics(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
