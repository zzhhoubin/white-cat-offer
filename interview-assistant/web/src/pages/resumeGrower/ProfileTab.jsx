export default function ProfileTab({ profile, onRefresh }) {
  const p = profile || {
    name: "—",
    city: "—",
    contact: "—",
    scenario: "—",
    roleFamily: "—",
    education: "—",
    skills: "—",
    star: "—",
  };

  return (
    <div className="rg-profile">
      <div className="rg-profile-toolbar">
        <button type="button" className="btn primary" onClick={onRefresh}>
          从简历+资料刷新
        </button>
        <span className="rg-meta">固定字段 · 手改优先（原型）</span>
      </div>
      <section className="rg-profile-sec">
        <header>
          <h3>基础身份</h3>
          <span className="rg-meta">来源：简历</span>
        </header>
        <div className="rg-kv">
          <div className="k">姓名</div>
          <div>{p.name}</div>
          <div className="k">城市</div>
          <div>{p.city}</div>
          <div className="k">联系</div>
          <div>{p.contact}</div>
        </div>
      </section>
      <section className="rg-profile-sec">
        <header>
          <h3>求职偏好</h3>
          <span className="rg-meta">来源：用户</span>
        </header>
        <div className="rg-kv">
          <div className="k">场景</div>
          <div>{p.scenario}</div>
          <div className="k">岗位族</div>
          <div>{p.roleFamily}</div>
        </div>
      </section>
      <section className="rg-profile-sec">
        <header>
          <h3>教育 / 技能</h3>
          <span className="rg-meta">来源：简历</span>
        </header>
        <div className="rg-kv">
          <div className="k">教育</div>
          <div>{p.education}</div>
          <div className="k">技能</div>
          <div>{p.skills}</div>
        </div>
      </section>
      <section className="rg-profile-sec">
        <header>
          <h3>STAR 案例库</h3>
          <span className="rg-meta">来源：项目深挖</span>
        </header>
        <div className="rg-star-card">{p.star}</div>
      </section>
    </div>
  );
}
