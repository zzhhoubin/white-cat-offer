import { useEffect, useState } from "react";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mdToHtml(text) {
  if (!text) return "";
  let t = escapeHtml(text);
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  t = t.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  t = t.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
  t = t.replace(/(?:<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  t = t
    .split(/\n{2,}/)
    .map((p) => (p.startsWith("<") ? p : `<p>${p.replace(/\n/g, "<br/>")}</p>`))
    .join("");
  return t;
}

const TABS = [
  { id: "reference", label: "参考回答" },
  { id: "depth", label: "深度解析与表达" },
  { id: "variants", label: "题目变体树" },
  { id: "followups", label: "面试官追问" },
  { id: "extend", label: "深度扩展" },
];

function Md({ text, className }) {
  if (!text) return null;
  return <div className={className || "qb-md"} dangerouslySetInnerHTML={{ __html: mdToHtml(text) }} />;
}

function OralCard({ items }) {
  if (!items?.length) return null;
  return (
    <section className="qb-oral">
      <h3>口述框架（易背版）</h3>
      <ol className="qb-oral-list">
        {items.map((item, i) => (
          <li key={`${item.step}-${i}`}>
            <span className="qb-oral-num">{i + 1}</span>
            <div>
              <div className="qb-oral-step">{item.step}</div>
              <Md text={item.text} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Followups({ items }) {
  if (!items?.length) return null;
  return (
    <div className="qb-follow">
      <p className="qb-lead">如果面试官继续往下挖，通常会问：</p>
      {items.map((item, i) => (
        <details key={i} className="qb-follow-card">
          <summary>
            <span className="qb-follow-idx">{String(i + 1).padStart(2, "0")}</span>
            {item.question}
          </summary>
          <div className="qb-follow-body">
            {item.intent ? (
              <div className="qb-hint">
                <strong>考察意图</strong>
                <Md text={item.intent} />
              </div>
            ) : null}
            {item.key_points ? (
              <div className="qb-hint">
                <strong>回答要点</strong>
                <Md text={item.key_points} />
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

export default function QuestionAnalysisTabs({
  question,
  tabs,
  needGenerate,
  generating,
  onGenerate,
  error,
}) {
  const [tab, setTab] = useState("reference");
  useEffect(() => {
    setTab("reference");
  }, [question, tabs]);

  if (needGenerate) {
    return (
      <div className="qb-analysis">
        <h2 className="qb-stem">{question}</h2>
        <div className="qb-studio-empty">
          <h3>尚未生成解析</h3>
          <p>点击后按深度解析 skill 生成五维回答，约 1–3 分钟。失败可重试，已生成的会记住。</p>
          {error ? <p className="status-line">{error}</p> : null}
          <button type="button" className="btn primary" disabled={generating} onClick={onGenerate}>
            {generating ? "生成中…" : error ? "重试" : "生成回答"}
          </button>
        </div>
      </div>
    );
  }

  if (!tabs) {
    return (
      <div className="qb-analysis">
        <h2 className="qb-stem">{question}</h2>
        <div className="qb-studio-empty">
          <h3>本题解析尚未入库</h3>
          <p>系统题只展示已持久化的解析。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="qb-analysis">
      <h2 className="qb-stem">{question}</h2>
      <nav className="qb-tabs" aria-label="解析分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="qb-tab-body">
        {tab === "reference" && (
          <>
            <OralCard items={tabs.reference?.oral_framework} />
            <h3 className="qb-sec">基础标准答案</h3>
            <Md text={tabs.reference?.standard_answer} />
          </>
        )}
        {tab === "depth" && (
          <>
            <p className="qb-lead">把这道题真正讲透</p>
            <Md text={tabs.depth?.deep_dive} />
            <section className="qb-warn">
              <h3>常见谬误与「减分项」警告</h3>
              <h4>高频坑</h4>
              <Md text={tabs.depth?.pitfalls_md} />
              <h4>加分表达</h4>
              <Md text={tabs.depth?.bonus_md} />
            </section>
          </>
        )}
        {tab === "variants" && (
          <>
            <p className="qb-lead">同一考点常见怎么变形</p>
            <pre className="qb-tree">{tabs.variants?.tree_md || "暂无变体"}</pre>
          </>
        )}
        {tab === "followups" && <Followups items={tabs.followups} />}
        {tab === "extend" && (
          <>
            <p className="qb-lead">从这道题，再往外扩一层</p>
            {tabs.extend?.concepts ? (
              <section className="qb-ext">
                <h3>核心概念</h3>
                <Md text={tabs.extend.concepts} />
              </section>
            ) : null}
            {tabs.extend?.cases ? (
              <section className="qb-ext">
                <h3>业务案例</h3>
                <Md text={tabs.extend.cases} />
              </section>
            ) : null}
            {tabs.extend?.tradeoffs ? (
              <section className="qb-ext">
                <h3>权衡取舍</h3>
                <Md text={tabs.extend.tradeoffs} />
              </section>
            ) : null}
            {tabs.extend?.learn ? (
              <section className="qb-ext">
                <h3>学习建议</h3>
                <Md text={tabs.extend.learn} />
              </section>
            ) : null}
            {!tabs.extend?.concepts && !tabs.extend?.cases ? <Md text={tabs.extend?.body_md} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
