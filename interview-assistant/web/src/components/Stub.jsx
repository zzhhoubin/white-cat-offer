export default function Stub({ title, desc, planned = [] }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="page-desc">{desc}</p>
      <div className="card stub-card">
        <span className="tag building">建设中</span>
        <h3>本模块规划功能</h3>
        <ul className="planned">
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="muted">
          当前阶段优先跑通「首页 + 简历素材 + 模拟/实时面试」主链路，此模块将在后续版本完善。
        </p>
      </div>
    </main>
  );
}
