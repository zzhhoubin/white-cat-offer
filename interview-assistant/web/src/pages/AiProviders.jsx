import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Check } from "lucide-react";
import { api } from "../api.js";

export default function AiProviders() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState("");
  const [activeProvider, setActiveProvider] = useState("deepseek");
  const [selectedId, setSelectedId] = useState("deepseek");
  const [providers, setProviders] = useState([]);
  const [form, setForm] = useState({ api_key: "", model_id: "", base_url: "" });

  const selected = useMemo(
    () => providers.find((p) => p.id === selectedId) || providers[0] || null,
    [providers, selectedId]
  );

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setForm({
      api_key: "",
      model_id: selected.model_id || selected.default_model || "",
      base_url: selected.base_url || selected.default_base_url || "",
    });
  }, [selected?.id]);

  async function load() {
    setLoading(true);
    setStatus("");
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 15000);
    try {
      const data = await api.getLlmConfig({ signal: ctrl.signal });
      const list = data.providers || [];
      const active = data.active_provider || "deepseek";
      setProviders(list);
      setActiveProvider(active);
      setSelectedId(active);
    } catch (e) {
      const msg =
        e?.name === "AbortError"
          ? "加载超时：后端无响应，请重启 backend（8765）后刷新"
          : e.message || "未知错误";
      setStatus("加载失败：" + msg);
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setStatus("正在保存…");
    try {
      const hasNewKey = Boolean(form.api_key.trim());
      const payload = {
        // 填写了 Key 时自动设为默认，避免「已配置」却未激活
        active_provider: hasNewKey ? selected.id : activeProvider,
        providers: {
          [selected.id]: {
            model_id: form.model_id,
            base_url: form.base_url,
            ...(hasNewKey ? { api_key: form.api_key.trim() } : {}),
          },
        },
      };
      const data = await api.putLlmConfig(payload);
      setProviders(data.providers || []);
      setActiveProvider(data.active_provider || selected.id);
      setForm((f) => ({ ...f, api_key: "" }));
      setStatus(hasNewKey ? `已保存并设为默认：${selected.name || selected.id}` : "已保存");
    } catch (e) {
      setStatus("保存失败：" + (e.message || "未知错误"));
    } finally {
      setSaving(false);
    }
  }

  async function setAsActive(id) {
    setSaving(true);
    try {
      const data = await api.putLlmConfig({ active_provider: id, providers: {} });
      setProviders(data.providers || []);
      setActiveProvider(data.active_provider || id);
      setStatus(`已切换默认服务商：${id}`);
    } catch (e) {
      setStatus("切换失败：" + (e.message || "未知错误"));
    } finally {
      setSaving(false);
    }
  }

  async function testConn() {
    setTesting(true);
    setStatus("正在测试连通性…");
    try {
      if (form.api_key.trim() || form.model_id || form.base_url) {
        await save();
      }
      const data = await api.testLlmConfig();
      if (data.ok) {
        setStatus(`连通成功（模型 ${data.model}）`);
      } else {
        setStatus("连通失败：" + (data.error || "未知错误"));
      }
    } catch (e) {
      setStatus("测试失败：" + (e.message || "未知错误"));
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <h1>AI 服务商</h1>
        <p className="page-desc">加载中…</p>
      </main>
    );
  }

  return (
    <main className="page ai-prov-page">
      <h1>AI 服务商</h1>
      <p className="page-desc">
        请配置并设为默认后，简历分析、面经、题库、模拟面试等 LLM 能力将使用此处凭证。未配置时相关功能不可用。
      </p>
      {status && providers.length === 0 && (
        <p className="status-line">{status}（可刷新页面重试）</p>
      )}

      <div className="ai-prov-layout">
        <aside className="ai-prov-list card">
          {providers.map((p) => {
            const isDefault = p.id === activeProvider;
            const isSelected = selected?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`ai-prov-item${isSelected ? " selected" : ""}`}
                onClick={() => setSelectedId(p.id)}
              >
                <span className="ai-prov-item-main">
                  <span className="ai-prov-name">{p.name}</span>
                  <span className={`ai-prov-badge${p.configured ? " ok" : ""}`}>
                    {p.configured ? "已配置" : "未配置"}
                  </span>
                </span>
                {isDefault && (
                  <span className="ai-prov-active-mark" title="当前默认">
                    <Check size={16} />
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <section className="ai-prov-detail card">
          {selected ? (
            <>
              <div className="ai-prov-detail-hd">
                <h2>{selected.name}</h2>
                <p>{selected.hint}</p>
              </div>

              <label className="ai-prov-field">
                <span className="ai-prov-label-row">
                  <span>API Key</span>
                  {selected.docs_url && (
                    <a href={selected.docs_url} target="_blank" rel="noreferrer" className="ai-prov-link">
                      获取 API Key <ExternalLink size={13} />
                    </a>
                  )}
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={selected.api_key_masked || "API Key"}
                  value={form.api_key}
                  onChange={(e) => updateField("api_key", e.target.value)}
                />
                {selected.api_key_masked && (
                  <span className="ai-prov-hint">已保存：{selected.api_key_masked}（留空保存则不修改）</span>
                )}
              </label>

              <label className="ai-prov-field">
                <span>模型 ID</span>
                <input
                  placeholder="模型 ID"
                  value={form.model_id}
                  onChange={(e) => updateField("model_id", e.target.value)}
                />
              </label>

              <label className="ai-prov-field">
                <span>API 端点，如：{selected.default_base_url || "https://api.openai.com/v1"}</span>
                <input
                  placeholder={selected.default_base_url || "https://..."}
                  value={form.base_url}
                  onChange={(e) => updateField("base_url", e.target.value)}
                />
              </label>

              <div className="ai-prov-actions">
                <button type="button" className="btn primary" disabled={saving} onClick={save}>
                  {saving ? "保存中…" : "保存配置"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={saving || activeProvider === selected.id}
                  onClick={() => setAsActive(selected.id)}
                >
                  设为默认
                </button>
                <button type="button" className="btn" disabled={testing || saving} onClick={testConn}>
                  {testing ? "测试中…" : "测试连通"}
                </button>
              </div>
            </>
          ) : (
            <p className="page-desc">请选择左侧服务商</p>
          )}
          {status && <p className="status-line">{status}</p>}
        </section>
      </div>
    </main>
  );
}
