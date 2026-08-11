import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResumeStore } from "../store.js";

export default function CertificatesEditor() {
  const { certificates, addCertificate, updateCertificate, removeCertificate } = useResumeStore();

  return (
    <div className="rg-editor-form">
      <h2 className="rg-editor-sec-title">证书</h2>
      <p className="rg-editor-hint">填写专业资格、行业认证等，可添加多条</p>

      {(certificates || []).map((c) => (
        <div key={c.id} className="rg-editor-card">
          <div className="rg-editor-card-head">
            <span className="rg-card-title">{c.name || "新证书"}</span>
            <button type="button" className="btn small mute" onClick={() => removeCertificate(c.id)}>
              <Trash2 size={14} />
            </button>
          </div>
          <div className="rg-editor-grid">
            <label className="rg-editor-field rg-field-wide">
              <span>证书名称</span>
              <input value={c.name} onChange={(ev) => updateCertificate(c.id, { name: ev.target.value })} placeholder="如：AWS Solutions Architect" />
            </label>
            <label className="rg-editor-field">
              <span>颁发机构</span>
              <input value={c.issuer} onChange={(ev) => updateCertificate(c.id, { issuer: ev.target.value })} placeholder="如：Amazon" />
            </label>
            <label className="rg-editor-field">
              <span>获得日期</span>
              <input value={c.date} onChange={(ev) => updateCertificate(c.id, { date: ev.target.value })} placeholder="2023.06" />
            </label>
            <label className="rg-editor-field">
              <span>有效期至</span>
              <input value={c.expiry} onChange={(ev) => updateCertificate(c.id, { expiry: ev.target.value })} placeholder="可空 / 长期有效" />
            </label>
            <label className="rg-editor-field">
              <span>证书编号</span>
              <input value={c.credentialId} onChange={(ev) => updateCertificate(c.id, { credentialId: ev.target.value })} placeholder="可空" />
            </label>
            <label className="rg-editor-field rg-field-wide">
              <span>备注</span>
              <input value={c.note} onChange={(ev) => updateCertificate(c.id, { note: ev.target.value })} placeholder="补充说明" />
            </label>
          </div>
        </div>
      ))}

      <button type="button" className="btn primary" onClick={addCertificate}>
        <Plus size={15} /> 添加证书
      </button>
    </div>
  );
}
