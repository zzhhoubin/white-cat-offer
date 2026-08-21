import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../home-saas.css";

const HERO = [
  {
    title: "海量真题 & 面经",
    lead: "帮你在面试前充分准备，让每次面试都有备而来",
  },
  {
    title: "模拟面试 & 实时辅助",
    lead: "帮你在面试中思路在线，流畅回答",
  },
];

const QUOTES = [
  {
    text: "有一说一，争哥的算法训练营真不错，特别是回溯、动态规划、二叉树，之前网上的很多资料，云里雾里，没有信心，看了争哥的讲解，再配合争哥给的题目，很透彻！也顺利通过了字节算法面试！",
    name: "LarryWei",
    tag: "字节Offer",
    ava: "lw",
    mark: "Larry Wei",
  },
  {
    text: "争哥，你的课写得真的特别棒特别好，每节课都干货满满，特别是职场课，很多认知看了才知道，真的后悔没有早点遇到你，不然现在应该可以混得更好！争哥，以后你就是我的人生导师！",
    name: "强哥",
    tag: "中厂Leader",
    ava: "qg",
    mark: "强",
  },
  {
    text: "看了争哥的《数据结构与算法之美》和《设计模式之美》，被争哥的逻辑征服了，这个会员的价格也非常亲民，不知道争哥能不能挣到钱，希望争哥后面不要涨价，照顾照顾我们这些穷学生！",
    name: "早睡早起",
    tag: "计算机在校生",
    ava: "bunny",
    mark: "兔",
  },
  {
    text: "争哥，在公司内网看到了你的课，你的课很受欢迎，知道争哥很强，但不知道这么强，特地过来跟争哥说一下，能加到争哥微信，围观整个朋友圈，很荣幸！希望争哥越来越牛逼！带小弟喝点汤！",
    name: "Jon",
    tag: "阿里工程师",
    ava: "jon",
    mark: "J",
  },
  {
    text: "校招看了争哥的Java课和算法课，真的可以吊打面试官，也拿到了快手、虾皮、字节、华为的Offer，特地来感谢一下争哥，期待争哥的系统设计课，继续跟着争哥学习，我以后应该会强得可怕吧，哈哈哈哈",
    name: "开心",
    tag: "应届校招",
    ava: "dog",
    mark: "开",
  },
  {
    text: "争哥好，看了您朋友圈发的超级会员，真的非常划算，相比于海外几千dollar，国内大几千的培训，您这个真的是质量又好又便宜，白菜价中的白菜价，立刻就下单购买了。",
    name: "Camellia",
    tag: "海外学生",
    ava: "cam",
    mark: "C",
  },
  {
    text: "谢谢争哥及时的回复，让我知道接下来该怎么办，职业规划也清晰了很多。PS：我的很多同事都知道你，直属领导还推荐给我你的课，他不知道其实你就在我好友列表里 :)",
    name: "璀璨如我",
    tag: "大厂实习生",
    ava: "scene",
    mark: "璀",
  },
  {
    text: "你的Java课的并发部分写得特别透彻，真的震惊到我了，我之前也看过很多相关内容，没有你写得这么清楚的。争哥，就你这课程质量，这价格简直是白嫖！",
    name: "Chao",
    tag: "后端老司机",
    ava: "chao",
    mark: "C",
  },
];

const FEATURES = [
  {
    tab: "简历优化 & 岗位匹配",
    hint: "文书 · 优化 · 按岗改写",
    tone: "purple",
    title: "简历优化 & 岗位匹配度分析",
    desc: "先看清和岗位差在哪，再按 JD 反向改写。文书有章法，优化有依据，不编造经历。",
    items: ["简历文书指导", "简历优化", "岗位匹配度分析", "根据岗位反向优化简历"],
    to: "/resume?tab=resumes",
    shot: "简历匹配界面截图待填",
  },
  {
    tab: "项目经历深挖",
    hint: "素材整理 · 故事化",
    tone: "purple",
    title: "项目经历深挖",
    desc: "把分散的材料收成可讲的故事：简历描述、口头介绍、面试追问题，都从你的真实项目来。",
    items: ["项目素材整理", "项目深挖"],
    to: "/resume?tab=deep-dive",
    shot: "项目深挖界面截图待填",
  },
  {
    tab: "海量真题深度解析",
    hint: "真题 · 面经",
    tone: "orange",
    title: "海量真题深度解析",
    desc: "按岗位刷高频题，读面经摸清问法。解析尽量贴你的经历，上场前有备而来。",
    items: ["高频面试题深度解析", "面经"],
    to: "/questions",
    shot: "真题解析界面截图待填",
  },
  {
    tab: "模拟面试 & 实时辅助",
    hint: "上场前练 · 上场中提",
    tone: "orange",
    title: "模拟面试 & 实时辅助面试",
    desc: "上场前先模拟过一遍；正式面试识别问题、给出提纲，帮你思路在线、流畅回答。开口的人是你。",
    items: ["模拟面试", "面试实时助手"],
    to: "/interview/realtime",
    shot: "面试辅助界面截图待填",
  },
];

function ShotSlot({ label }) {
  return (
    <div className="hs-shot" aria-label={label}>
      <span>{label}</span>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [heroI, setHeroI] = useState(0);
  const [featI, setFeatI] = useState(0);
  const [heroHover, setHeroHover] = useState(false);
  const feat = FEATURES[featI];

  useEffect(() => {
    if (heroHover) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }
    const t = setInterval(() => setHeroI((i) => (i + 1) % HERO.length), 2000);
    return () => clearInterval(t);
  }, [heroHover]);

  return (
    <main className="home-saas">
      <section
        className="hs-hero"
        id="hero"
        onMouseEnter={() => setHeroHover(true)}
        onMouseLeave={() => setHeroHover(false)}
      >
        <div className="hs-blobs" aria-hidden="true">
          <i className="purple" />
          <i className="warm" />
          <i className="cool" />
        </div>
        <div className="hs-container">
          <div className="hs-hero-stage">
            <div className="hs-hero-copy-stage">
              {HERO.map((s, i) => (
                <article
                  key={s.title}
                  className={`hs-hero-slide${i === heroI ? " is-on" : ""}`}
                  aria-hidden={i !== heroI}
                >
                  <div className="hs-hero-copy">
                    <h1>{s.title}</h1>
                    <p className="hs-lead">{s.lead}</p>
                    <div className="hs-hero-actions">
                      <button
                        type="button"
                        className="hs-btn hs-btn-dark"
                        onClick={() => navigate("/questions")}
                      >
                        开始准备
                      </button>
                      <button
                        type="button"
                        className="hs-btn hs-btn-ghost"
                        onClick={() =>
                          document.getElementById("features")?.scrollIntoView({
                            behavior: "smooth",
                          })
                        }
                      >
                        查看功能
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hs-hero-visual-wrap">
              <img
                className="hs-hero-visual"
                src="/hero-showcase.png?v=2"
                alt="简历优化、面试辅助、面试真题、项目深挖、简历评分"
              />
            </div>
          </div>
          <div className="hs-dots" role="tablist" aria-label="Hero 轮播">
            {HERO.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                aria-label={`第 ${i + 1} 屏`}
                className={i === heroI ? "is-on" : ""}
                onClick={() => setHeroI(i)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="hs-section hs-section-muted" id="features">
        <div className="hs-container">
          <div className="hs-sec-h">
            <h2>求职全程帮手</h2>
            <p>
              求职全流程陪伴，从简历文书到面试实战，助您提升面试表现，提高面试成功率
            </p>
          </div>
          <div className="hs-feat">
            <div className="hs-feat-tabs" role="tablist" aria-label="产品功能">
              {FEATURES.map((f, i) => (
                <button
                  key={f.tab}
                  type="button"
                  role="tab"
                  aria-selected={i === featI}
                  className={`hs-feat-tab${i === featI ? " is-on" : ""}`}
                  data-tone={f.tone}
                  onClick={() => setFeatI(i)}
                >
                  {f.tab}
                  <small>{f.hint}</small>
                </button>
              ))}
            </div>
            <article className="hs-feat-pane" data-tone={feat.tone}>
              <div className="hs-feat-copy">
                <h3>{feat.title}</h3>
                <p>{feat.desc}</p>
                <ul>
                  {feat.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="hs-btn hs-btn-dark"
                  onClick={() => navigate(feat.to)}
                >
                  进入
                </button>
              </div>
              <ShotSlot label={feat.shot} />
            </article>
          </div>
        </div>
      </section>

      <section className="hs-section" id="quotes">
        <div className="hs-container">
          <div className="hs-sec-h">
            <h2>用过的人，这样准备面试</h2>
          </div>
          <div className="hs-quotes">
            {QUOTES.map((q) => (
              <article key={q.name} className="hs-quote">
                <p>{q.text}</p>
                <div className="hs-quote-user">
                  <span className={`hs-quote-ava is-${q.ava}`} aria-hidden="true">
                    {q.mark}
                  </span>
                  <div>
                    <strong>{q.name}</strong>
                    <small>{q.tag}</small>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="hs-footer">
        <div className="hs-container hs-footer-grid">
          <div>
            <div className="hs-footer-brand">
              <img src="/logo.png" alt="" className="hs-footer-logo" />
              GoodJob
            </div>
            <p>从准备简历到参加面试：真题与面经让你有备而来，模拟与实时辅助让你思路在线。</p>
          </div>
          <div>
            <h5>产品服务</h5>
            <ul>
              <li>
                <button type="button" onClick={() => navigate("/resume?tab=resumes")}>
                  简历养成记
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/questions")}>
                  题库
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/mianjing")}>
                  面经
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/interview/mock")}>
                  模拟面试
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/interview/realtime")}>
                  实时辅助
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h5>使用须知</h5>
            <ul>
              <li className="hs-footer-note">不代答 · 不替面 · 不鼓励伪造经历</li>
              <li className="hs-footer-note">请遵守面试平台与招聘方规则</li>
            </ul>
          </div>
          <div className="hs-qr-slot" aria-label="客服二维码待填">
            <span>客服二维码待填</span>
          </div>
        </div>
        <div className="hs-container hs-footer-bottom">
          © {new Date().getFullYear()} whitecat
        </div>
      </footer>
    </main>
  );
}
