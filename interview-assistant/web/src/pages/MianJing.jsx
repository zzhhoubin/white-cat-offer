import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Check, Star, X } from "lucide-react";
import { api } from "../api.js";
import JobTypeSelect from "../components/JobTypeSelect.jsx";
import { FEATURED_BANK_TREE } from "../data/featuredBankTree.js";

const FLAG_KEY = "mj_v2_flags";
const PAGE = 10;

function loadFlags() {
  try {
    return JSON.parse(localStorage.getItem(FLAG_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveFlags(flags) {
  try {
    localStorage.setItem(FLAG_KEY, JSON.stringify(flags));
  } catch (e) {
    console.warn("保存面经标记失败", e);
  }
}

export default function MianJing() {
  const navigate = useNavigate();
  const [jobL1, setJobL1] = useState("互联网 / AI‑IT 技术");
  const [jobL2, setJobL2] = useState("后端开发");
  const [jobL3, setJobL3] = useState("Java");
  const [jobOpen, setJobOpen] = useState(false);
  const [company, setCompany] = useState("");
  const [companyQ, setCompanyQ] = useState("");
  const [companyHits, setCompanyHits] = useState([]);
  const [companyOpen, setCompanyOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openItem, setOpenItem] = useState(null);
  const [flags, setFlags] = useState(() => loadFlags());
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const sentinelRef = useRef(null);
  const companyBoxRef = useRef(null);

  function patchFlags(id, key) {
    setFlags((prev) => {
      const next = {
        seen: { ...(prev.seen || {}) },
        fav: { ...(prev.fav || {}) },
      };
      next[key][id] = !next[key][id];
      saveFlags(next);
      return next;
    });
  }

  async function loadPage(reset) {
    if (!jobL3 || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    const offset = reset ? 0 : offsetRef.current;
    try {
      const data = await api.mianjingFeed({
        jobL3,
        company,
        offset,
        limit: PAGE,
      });
      const batch = data.items || [];
      offsetRef.current = offset + batch.length;
      setHasMore(Boolean(data.has_more));
      setItems((prev) => (reset ? batch : [...prev, ...batch]));
      if (data.error) setError(data.error);
    } catch (e) {
      setError(e.message || "加载失败");
      if (reset) setItems([]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }

  useEffect(() => {
    offsetRef.current = 0;
    setItems([]);
    setHasMore(false);
    if (!jobL3) return undefined;
    loadPage(true);
    return undefined;
  }, [jobL3, company]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!companyQ.trim()) {
        setCompanyHits([]);
        return;
      }
      try {
        const data = await api.mianjingCompanies(companyQ.trim());
        setCompanyHits(data.companies || []);
      } catch {
        setCompanyHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [companyQ]);

  useEffect(() => {
    function onDoc(e) {
      if (companyBoxRef.current?.contains(e.target)) return;
      setCompanyOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && jobL3 && !loadingRef.current) {
          loadPage(false);
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, jobL3, company, items.length]);

  const emptyHint = !jobL3
    ? "请选择岗位查看面经"
    : loading && !items.length
      ? "加载中…"
      : "该筛选下暂无面经";

  return (
    <div className="mj-v2-page">
      <div className="mj-v2-shell">
      <div className="mj-v2-main">
        <div className="mj-v2-inner">
          <header className="mj-v2-filters">
            <div className="mj-v2-field">
              <label>岗位</label>
              <JobTypeSelect
                l1={jobL1}
                l2={jobL2}
                l3={jobL3}
                open={jobOpen}
                setOpen={setJobOpen}
                onChange={(nextL1, nextL2, nextL3) => {
                  setJobL1(nextL1);
                  setJobL2(nextL2);
                  setJobL3(nextL3);
                }}
              />
            </div>
            <div className="mj-v2-field" ref={companyBoxRef}>
              <label>公司</label>
              <input
                value={companyQ}
                placeholder="输入想看的企业"
                onFocus={() => setCompanyOpen(true)}
                onChange={(e) => {
                  const v = e.target.value;
                  setCompanyQ(v);
                  setCompanyOpen(true);
                  if (!v.trim()) setCompany("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setCompany(companyQ.trim());
                    setCompanyOpen(false);
                  }
                }}
              />
              {companyOpen && companyHits.length > 0 && (
                <div className="mj-v2-suggest">
                  {companyHits.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setCompanyQ(name);
                        setCompany(name);
                        setCompanyOpen(false);
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </header>

          {error && <p className="mj-v2-error">{error}</p>}

          {!items.length ? (
            <div className="mj-v2-empty">
              <BookOpen size={36} />
              <p>{emptyHint}</p>
            </div>
          ) : (
            <div className="mj-v2-feed">
              {items.map((item) => (
                <article key={item.id} className="mj-v2-card">
                  <div className="mj-v2-card-hd">
                    <h2>{item.title}</h2>
                    <span>{item.company}</span>
                  </div>
                  <p className="mj-v2-excerpt">{item.content}</p>
                  <button type="button" className="mj-v2-more" onClick={() => setOpenItem(item)}>
                    查看更多
                  </button>
                  <CardActions
                    seen={Boolean(flags.seen?.[item.id])}
                    fav={Boolean(flags.fav?.[item.id])}
                    onSeen={() => patchFlags(item.id, "seen")}
                    onFav={() => patchFlags(item.id, "fav")}
                  />
                </article>
              ))}
              <div ref={sentinelRef} className="mj-v2-sentinel">
                {loading ? "加载中…" : hasMore ? "" : "没有更多了"}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="mj-v2-rail">
        <div className="mj-v2-baodian">
          <h3>题库</h3>
          {FEATURED_BANK_TREE.map((group) => (
            <button
              key={group.l1}
              type="button"
              className="mj-v2-baodian-item"
              onClick={() => navigate(`/questions?l1=${encodeURIComponent(group.l1)}`)}
            >
              <img src={group.icon} alt="" />
              <span>{group.l1}</span>
            </button>
          ))}
        </div>
      </aside>
      </div>

      {openItem && (
        <div className="mj-v2-overlay" onClick={() => setOpenItem(null)}>
          <div className="mj-v2-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="mj-v2-modal-close" onClick={() => setOpenItem(null)}>
              <X size={18} />
            </button>
            <div className="mj-v2-card-hd">
              <h2>{openItem.title}</h2>
              <span>{openItem.company}</span>
            </div>
            <pre className="mj-v2-full">{openItem.content}</pre>
            <CardActions
              seen={Boolean(flags.seen?.[openItem.id])}
              fav={Boolean(flags.fav?.[openItem.id])}
              onSeen={() => patchFlags(openItem.id, "seen")}
              onFav={() => patchFlags(openItem.id, "fav")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CardActions({ seen, fav, onSeen, onFav }) {
  return (
    <div className="mj-v2-actions">
      <button type="button" className={seen ? "on" : ""} onClick={onSeen}>
        <Check size={15} />
        已看
      </button>
      <button type="button" className={fav ? "on" : ""} onClick={onFav}>
        <Star size={15} />
        收藏
      </button>
    </div>
  );
}
