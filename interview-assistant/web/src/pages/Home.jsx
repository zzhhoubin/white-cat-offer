import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Lock,
  Mic,
  Monitor,
  Send,
  Shield,
  Star,
} from "lucide-react";
import "../home-saas.css";

const MODULES = [
  {
    icon: FileText,
    title: "AI 简历工坊",
    to: "/resume?tab=resumes",
    items: [
      "简历创建、编辑、导出与归档",
      "简历智能评分 + 优缺点诊断",
      "经历素材提炼，撰写工作/项目经历",
      "对标 JD 定制改写，提升通过率",
    ],
  },
  {
    icon: BookOpen,
    title: "求职知识库",
    to: "/questions",
    items: [
      "面经资料查阅学习",
      "项目深挖包装，丰富面试话术",
      "分类面试题库，分岗位刷题备考",
      "标准化项目库，快速填充简历",
    ],
  },
  {
    icon: Send,
    title: "智能投递系统",
    to: "/projects",
    items: [
      "基于简历画像推荐匹配岗位",
      "多平台简历批量自动投递（规划中）",
      "投递记录统一管理追踪状态（规划中）",
    ],
  },
  {
    icon: Mic,
    title: "AI 面试训练",
    to: "/interview/realtime",
    items: [
      "真人式 AI 模拟面试演练",
      "实时面试答题提示与话术提纲",
      "面试复盘，纠正回答短板",
    ],
  },
];

const STEPS = [
  {
    n: "1",
    title: "上传个人资料",
    desc: "导入简历与项目材料，系统拆解成可复用的素材库",
  },
  {
    n: "2",
    title: "AI 生成优化简历",
    desc: "粘贴 JD 一键匹配改写，打分并给出修改方案",
  },
  {
    n: "3",
    title: "刷题 + 模拟 + 上场",
    desc: "专属题库巩固，模拟面试脱敏，实时辅助正式面试",
  },
];

const TRUST = [
  {
    icon: Check,
    title: "全链路覆盖求职关键节点",
    desc: "从材料沉淀、简历打磨到模拟与实时辅助，再到复盘回填",
  },
  {
    icon: Lock,
    title: "本地资料可控，按需接入模型",
    desc: "支持自配 AI 服务商；材料与会话由你自行管理，可随时清理",
  },
  {
    icon: Shield,
    title: "辅助而非代答",
    desc: "不自动代答、不替你面试；输出提纲与参考，回答仍由你完成",
  },
];

const FAQS = [
  {
    q: "我的简历个人信息是否会被平台泄露？",
    a: "资料默认由你本地/自有账号侧管理；接入第三方模型时请自行评估服务商隐私政策。可随时删除简历与材料。",
  },
  {
    q: "和「代答」类工具有什么区别？",
    a: "本产品定位为面试辅助：识别问题、匹配你的经历素材、输出回答提纲与风险提示，不鼓励伪造经历或违规代答。",
  },
  {
    q: "支持什么环境使用？",
    a: "浏览器内即可使用核心能力；桌面客户端能力按版本逐步开放。建议使用现代 Chromium 内核浏览器以获得最佳音视频体验。",
  },
  {
    q: "AI 优化的简历可以直接投递吗？",
    a: "建议结合真实经历微调后再投递。内容应基于你本人资料生成，避免夸大或虚构。",
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <main className="home-saas">
      <section className="hs-hero">
        <div className="hs-container hs-hero-grid">
          <div className="hs-hero-copy">
            <span className="hs-badge">全链路求职 AI 工具</span>
            <h1>
              AI 一键打磨简历｜JD 精准匹配
              <br />
              模拟面试刷题，求职上岸提速
            </h1>
            <p className="hs-lead">
              简历评分诊断、经历素材提炼、项目深度包装、面试题库、AI
              全真模拟与实时辅助——一套工具覆盖求职关键环节
            </p>
            <div className="hs-hero-actions">
              <button
                type="button"
                className="hs-btn hs-btn-action"
                onClick={() => navigate("/interview/realtime")}
              >
                立即免费体验
              </button>
              <button
                type="button"
                className="hs-btn hs-btn-outline"
                onClick={() => {
                  document.getElementById("function")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                查看全部功能
              </button>
            </div>
            <div className="hs-trust-inline">
              <span>
                <Check size={14} strokeWidth={2.5} />
                无需绑定银行卡
              </span>
              <span>
                <Check size={14} strokeWidth={2.5} />
                资料自行可控管理
              </span>
              <span>
                <Check size={14} strokeWidth={2.5} />
                浏览器即可使用
              </span>
            </div>
          </div>
          <div className="hs-hero-visual" aria-hidden="true">
            <div className="hs-preview-card">
              <Monitor size={56} strokeWidth={1.25} />
              <span>产品界面预览区</span>
            </div>
          </div>
        </div>
      </section>

      <section id="function" className="hs-section">
        <div className="hs-container">
          <div className="hs-section-head">
            <h2>四大核心模块，覆盖求职全流程</h2>
            <p>从简历制作、知识库查阅、投递准备到面试实战训练，一站式解决求职难题</p>
          </div>
          <div className="hs-modules">
            {MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.title}
                  type="button"
                  className="hs-module-card"
                  onClick={() => navigate(m.to)}
                >
                  <div className="hs-module-icon">
                    <Icon size={20} />
                  </div>
                  <h3>{m.title}</h3>
                  <ul>
                    {m.items.map((item) => (
                      <li key={item}>
                        <ChevronRight size={14} className="hs-li-icon" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section id="process" className="hs-section hs-section-muted">
        <div className="hs-container">
          <div className="hs-section-head">
            <h2>三步开启高效求职</h2>
            <p>零学习成本，上传资料即可使用全部 AI 能力</p>
          </div>
          <div className="hs-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="hs-step">
                <div className="hs-step-num">{s.n}</div>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="hs-section">
        <div className="hs-container hs-trust-grid">
          <div>
            <h2>求职闭环可验证，数据安全可控</h2>
            <div className="hs-trust-list">
              {TRUST.map((t) => {
                const Icon = t.icon;
                return (
                  <div key={t.title} className="hs-trust-item">
                    <div className="hs-trust-icon">
                      <Icon size={18} />
                    </div>
                    <div>
                      <h5>{t.title}</h5>
                      <p>{t.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="hs-quote-card">
            <p>
              “原本简历平平无奇，用 JD 匹配改写 + 项目深挖之后，一周收到多家面试邀约；模拟面试帮我改掉了回答卡顿的问题。”
            </p>
            <div className="hs-quote-user">
              <div className="hs-avatar" />
              <div>
                <div className="hs-quote-name">互联网后端求职者</div>
                <div className="hs-stars" aria-label="5 星">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} fill="currentColor" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="hs-section">
        <div className="hs-container hs-faq">
          <div className="hs-section-head">
            <h2>常见问题解答</h2>
          </div>
          <div className="hs-faq-list">
            {FAQS.map((f) => (
              <details key={f.q} className="hs-faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="hs-cta-banner">
        <div className="hs-container">
          <h2>立刻使用 AI 工具，拿下心仪 Offer</h2>
          <p>简历优化、面试训练、岗位准备一站式解决，现在即可免费体验</p>
          <button
            type="button"
            className="hs-btn hs-btn-action hs-btn-lg"
            onClick={() => navigate("/interview/realtime")}
          >
            立即免费开启体验
          </button>
        </div>
      </section>

      <footer className="hs-footer">
        <div className="hs-container hs-footer-grid">
          <div>
            <div className="hs-footer-brand">
              <img src="/logo.png" alt="" className="hs-footer-logo" />
              whitecat
            </div>
            <p>专注面向求职者的 AI 简历与面试全链路工具</p>
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
                <button type="button" onClick={() => navigate("/interview/mock")}>
                  模拟面试
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h5>帮助支持</h5>
            <ul>
              <li>
                <a href="#faq">常见问题</a>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/ai-providers")}>
                  AI 服务商配置
                </button>
              </li>
              <li>
                <button type="button" onClick={() => navigate("/account")}>
                  账号
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h5>使用须知</h5>
            <ul>
              <li className="hs-footer-note">
                不代答 · 不替面 · 不鼓励伪造经历
              </li>
              <li className="hs-footer-note">请遵守面试平台与招聘方规则</li>
            </ul>
          </div>
        </div>
        <div className="hs-container hs-footer-bottom">
          © {new Date().getFullYear()} whitecat
        </div>
      </footer>
    </main>
  );
}
