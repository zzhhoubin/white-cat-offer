import { useEffect, useRef, useState } from "react";
import { api, getAuthToken, getWsBase } from "../api.js";
import { getResumes } from "./resumeGrower/storage.js";

const TARGET_SAMPLE_RATE = 16000;
const RECORDS_KEY = "rt_assist_records_v1";
const LANG_OPTIONS = ["无", "Python", "SQL", "Java", "JavaScript", "TypeScript", "Go", "C++", "R", "Scala"];
const JOB_TREE = [
  {
    l1: "互联网/AI",
    l2: ["算法工程师", "数据分析", "后端开发", "前端开发", "测试开发", "其他"],
  },
  {
    l1: "电子/电气/通信",
    l2: ["通信工程师", "自动化工程师", "嵌入式开发", "半导体/芯片", "机械工程", "其他"],
  },
  {
    l1: "产品",
    l2: ["产品经理", "产品运营", "商业分析", "其他"],
  },
  {
    l1: "客服/运营",
    l2: ["用户运营", "内容运营", "客服专员", "其他"],
  },
  {
    l1: "销售",
    l2: ["销售代表", "客户成功", "商务拓展", "其他"],
  },
  {
    l1: "人力/行政/法务",
    l2: ["招聘", "HRBP", "行政", "法务", "其他"],
  },
];
const JOB_LANG_PRESETS = {
  "互联网/AI": ["Python", "SQL"],
  "电子/电气/通信": ["C++", "Python"],
  产品: ["SQL"],
  "客服/运营": ["SQL"],
  销售: ["无"],
  "人力/行政/法务": ["无"],
};
const SELECT_CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath stroke='%236b7280' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M2 2.5L6 6.5L10 2.5'/%3E%3C/svg%3E\")";

function downsample(buffer, inRate, outRate) {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let outIdx = 0;
  let inBase = 0;
  while (outIdx < newLen) {
    const next = Math.round((outIdx + 1) * ratio);
    let acc = 0;
    let cnt = 0;
    for (let i = inBase; i < next && i < buffer.length; i += 1) {
      acc += buffer[i];
      cnt += 1;
    }
    result[outIdx] = cnt ? acc / cnt : 0;
    outIdx += 1;
    inBase = next;
  }
  return result;
}

function floatTo16BitPCM(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

function outlineToText(outline) {
  if (!outline) return "";
  if (typeof outline === "string") return outline;
  if (outline.answer) return outline.answer;
  const parts = [];
  if (outline.example) parts.push(outline.example);
  if (outline.structure?.length) parts.push(outline.structure.join("。") + "。");
  if (outline.intent) parts.push(`考察意图：${outline.intent}`);
  if (outline.keywords?.length) parts.push(`关键词：${outline.keywords.join("、")}`);
  if (outline.risk && outline.risk !== "无") parts.push(`风险：${outline.risk}`);
  return parts.join("\n");
}

function resolveAnswer(outline) {
  if (!outline) return "";
  if (typeof outline === "string") return outline;
  if (outline.answer) return outline.answer;
  const parts = [];
  if (outline.example) parts.push(outline.example);
  if (outline.structure?.length) parts.push(outline.structure.join("。") + "。");
  return parts.join("\n\n");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightAnswer(answer, keywords) {
  if (!answer) return null;
  const kws = (keywords || []).map(String).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!kws.length) return answer;
  const re = new RegExp(`(${kws.map(escapeRegExp).join("|")})`, "g");
  const parts = String(answer).split(re);
  return parts.map((part, i) =>
    kws.includes(part) ? (
      <mark key={i} className="rt-hl">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function AnswerBody({ outline }) {
  if (!outline) {
    return <span className="rt-v2-empty">识别到问题后，将在此生成参考回答</span>;
  }
  if (typeof outline === "string") {
    return <div className="rt-answer-body-text">{outline}</div>;
  }
  const answer = resolveAnswer(outline);
  return (
    <>
      {outline.intent && <p className="rt-intent-line">考察：{outline.intent}</p>}
      <div className="rt-answer-body-text">{highlightAnswer(answer, outline.keywords) || "暂无参考答案"}</div>
      {outline.structure?.length > 0 && (
        <div className="rt-structure-inline">
          <h4>回答结构</h4>
          <ol>
            {outline.structure.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </div>
      )}
      {outline.personal_refs?.length > 0 && (
        <div className="rt-structure-meta">
          <h4>可引用经历</h4>
          <p>{outline.personal_refs.join(" · ")}</p>
        </div>
      )}
      {outline.risk && outline.risk !== "无" && <div className="mock-risk-box">⚠ {outline.risk}</div>}
    </>
  );
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function formatInterviewTime(at) {
  const ts = Number(at);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORDS_KEY) || "[]") || [];
  } catch {
    return [];
  }
}

function saveRecords(list) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(list.slice(0, 50)));
}

function FloatWin({ visible, stealth, question, outline, onStealth, onEnd, dragRef }) {
  const points = outline?.structure?.slice(0, 3) || outline?.keywords?.slice(0, 3) || [];
  const answerPreview = resolveAnswer(outline);
  return (
    <div className={`rt-float-win${visible ? " visible" : ""}${stealth ? " hidden-stealth" : ""}`} ref={dragRef}>
      <div className="rt-float-head" data-drag-handle="1">
        <div className="rt-float-title">
          <span className="rt-float-dot" />
          实时辅助
        </div>
        <div className="rt-float-actions">
          <button type="button" onClick={onStealth} title="隐身">
            −
          </button>
          <button type="button" onClick={onEnd} title="结束">
            ×
          </button>
        </div>
      </div>
      <div className="rt-float-body">
        <div className={`rt-float-q${!question ? " empty" : ""}`}>{question || "等待面试官提问…"}</div>
        {answerPreview && <p className="rt-float-answer">{answerPreview}</p>}
        {points.length > 0 && (
          <ol className="rt-float-ol">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        )}
        <div className="rt-float-hint">拖拽标题栏 · Ctrl+\ 隐身</div>
      </div>
    </div>
  );
}

function JobTypeSelect({ l1, l2, onChange, open, setOpen }) {
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [hoverL1, setHoverL1] = useState(l1 || JOB_TREE[0].l1);
  const activeL1 = open ? hoverL1 || l1 || JOB_TREE[0].l1 : l1 || hoverL1 || JOB_TREE[0].l1;
  const l2List = JOB_TREE.find((x) => x.l1 === activeL1)?.l2 || [];
  const label = l1 && l2 ? `${l1} > ${l2}` : "";

  useEffect(() => {
    if (open) setHoverL1(l1 || JOB_TREE[0].l1);
  }, [open, l1]);

  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const popH = Math.min(320, window.innerHeight - 24);
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const placeBelow = spaceBelow >= 220 || spaceBelow >= rect.top;
      pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 420) - 8))}px`;
      pop.style.width = `${Math.max(rect.width, 420)}px`;
      pop.style.top = placeBelow
        ? `${rect.bottom + gap}px`
        : `${Math.max(8, rect.top - gap - Math.min(popH, 280))}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, activeL1]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);

  return (
    <div className="rt-v2-job">
      <button
        type="button"
        className={`rt-v2-job-trigger${open ? " open" : ""}`}
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        style={{ backgroundImage: SELECT_CARET }}
      >
        {label ? <span>{label}</span> : <span className="rt-v2-ms-ph">请选择</span>}
      </button>
      {open && (
        <div className="rt-v2-job-pop" ref={popRef} role="listbox">
          <div className="rt-v2-job-col">
            {JOB_TREE.map((item) => {
              const on = item.l1 === l1;
              const hover = item.l1 === activeL1;
              return (
                <button
                  type="button"
                  key={item.l1}
                  className={`rt-v2-job-opt${on ? " on" : ""}${hover ? " hover" : ""}`}
                  onMouseEnter={() => setHoverL1(item.l1)}
                  onClick={() => setHoverL1(item.l1)}
                >
                  <span>{item.l1}</span>
                  {on && <span className="tick">✓</span>}
                </button>
              );
            })}
          </div>
          <div className="rt-v2-job-col">
            {l2List.map((name) => {
              const on = activeL1 === l1 && name === l2;
              return (
                <button
                  type="button"
                  key={name}
                  className={`rt-v2-job-opt${on ? " on" : ""}`}
                  onClick={() => {
                    onChange(activeL1, name);
                    setOpen(false);
                  }}
                >
                  <span>{name}</span>
                  {on && <span className="tick">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function toggleLangSelection(prev, lang) {
  if (lang === "无") {
    return prev.length === 1 && prev[0] === "无" ? ["无"] : ["无"];
  }
  const withoutNone = prev.filter((x) => x !== "无");
  if (withoutNone.includes(lang)) {
    const next = withoutNone.filter((x) => x !== lang);
    return next.length ? next : ["无"];
  }
  return [...withoutNone, lang];
}

function LangMultiSelect({ value, onChange, open, setOpen, query, setQuery }) {
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const filtered = LANG_OPTIONS.filter((lang) => !query.trim() || lang.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const popH = 284;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const placeBelow = spaceBelow >= popH || spaceBelow >= rect.top;
      pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
      pop.style.width = `${rect.width}px`;
      pop.style.top = placeBelow ? `${rect.bottom + gap}px` : `${Math.max(8, rect.top - gap - popH)}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, value, query]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);

  return (
    <div className="rt-v2-ms">
      <button
        type="button"
        className={`rt-v2-ms-trigger${open ? " open" : ""}`}
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        style={{ backgroundImage: SELECT_CARET }}
      >
        {!value.length ? (
          <span className="rt-v2-ms-ph">请选择编程语言</span>
        ) : (
          value.map((lang) => (
            <span className="rt-v2-ms-tag" key={lang}>
              {lang}
              <button
                type="button"
                aria-label="移除"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(toggleLangSelection(value, lang));
                }}
              >
                ×
              </button>
            </span>
          ))
        )}
      </button>
      {open && (
        <div className="rt-v2-ms-pop" ref={popRef} role="listbox">
          <div className="rt-v2-ms-search">
            <input
              type="text"
              placeholder="搜索语言"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="rt-v2-ms-list">
            {filtered.length === 0 ? (
              <div className="rt-v2-ms-empty">无匹配语言</div>
            ) : (
              filtered.map((lang) => {
                const on = value.includes(lang);
                return (
                  <button
                    type="button"
                    key={lang}
                    className={`rt-v2-ms-opt${on ? " on" : ""}`}
                    onClick={() => {
                      onChange(toggleLangSelection(value, lang));
                    }}
                  >
                    <span className="tick">✓</span>
                    <span>{lang}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RealtimeAssist() {
  const [phase, setPhase] = useState("home");
  const [records, setRecords] = useState(() => loadRecords());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(1);

  const [resumes, setResumes] = useState([]);
  const [resumeId, setResumeId] = useState("");
  const [jdText, setJdText] = useState("");
  const [kb, setKb] = useState("none");
  const [jobL1, setJobL1] = useState("");
  const [jobL2, setJobL2] = useState("");
  const [jobOpen, setJobOpen] = useState(false);
  const [langs, setLangs] = useState(["Python", "SQL"]);
  const [agree, setAgree] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState("");

  const [audioSource, setAudioSource] = useState("system");
  const [micDevices, setMicDevices] = useState([]);
  const [spkDevices, setSpkDevices] = useState([]);
  const [micId, setMicId] = useState("");
  const [spkId, setSpkId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micHint, setMicHint] = useState("点击测试后说话，查看电平");
  const [spkHint, setSpkHint] = useState("点击测试播放提示音");

  const [statusKind, setStatusKind] = useState("idle");
  const [statusText, setStatusText] = useState("未开始");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [partialText, setPartialText] = useState("");
  const [currentOutline, setCurrentOutline] = useState(null);
  const [history, setHistory] = useState([]);
  const [chat, setChat] = useState([]);
  const [stealth, setStealth] = useState(false);
  const [simInput, setSimInput] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [configSnap, setConfigSnap] = useState(null);
  const [reportRec, setReportRec] = useState(null);
  const [ansStatus, setAnsStatus] = useState("");

  const wsRef = useRef(null);
  const audioRef = useRef({ stream: null, context: null, processor: null, source: null });
  const floatRef = useRef(null);
  const questionSourceRef = useRef("");
  const fileRef = useRef(null);
  const leftRef = useRef(null);
  const workspaceRef = useRef(null);
  const qPanelRef = useRef(null);
  const composerRef = useRef(null);
  const chatScrollRef = useRef(null);
  const micTestRef = useRef(null);
  const backIgnoreRef = useRef(false);
  const endSessionRef = useRef(null);

  useEffect(() => {
    setResumes(getResumes() || []);
    api.getAssets().catch(() => {});
    return () => teardownSession();
  }, []);

  useEffect(() => {
    if (phase !== "active" || !startedAt) {
      setElapsedMs(0);
      return undefined;
    }
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, startedAt]);

  useEffect(() => {
    document.body.classList.toggle("rt-v2-interviewing", phase === "active");
    return () => document.body.classList.remove("rt-v2-interviewing");
  }, [phase]);

  useEffect(() => {
    if (phase !== "active") return undefined;
    window.history.pushState({ rtInterviewGuard: true }, "");
    function onPop() {
      if (backIgnoreRef.current) {
        backIgnoreRef.current = false;
        return;
      }
      const ok = window.confirm("正在进行面试，确认要退出");
      if (ok) {
        endSessionRef.current?.({ fromBack: true });
      } else {
        window.history.pushState({ rtInterviewGuard: true }, "");
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [phase]);

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        if (phase === "active") setStealth((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase]);

  useEffect(() => {
    const win = floatRef.current;
    if (!win || phase !== "active") return undefined;
    let dragging = false;
    let ox = 0;
    let oy = 0;
    function onDown(e) {
      if (!e.target.closest("[data-drag-handle]")) return;
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = win.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      win.style.right = "auto";
      win.style.bottom = "auto";
      win.style.left = `${rect.left}px`;
      win.style.top = `${rect.top}px`;
    }
    function onMove(e) {
      if (!dragging) return;
      win.style.left = `${Math.max(0, e.clientX - ox)}px`;
      win.style.top = `${Math.max(0, e.clientY - oy)}px`;
    }
    function onUp() {
      dragging = false;
    }
    win.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      win.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [phase]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  function showToast(msg) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1800);
  }

  function appendChat(who, text) {
    setChat((prev) => [...prev, { who, text, at: Date.now() }]);
  }

  function teardownAudio() {
    const audio = audioRef.current;
    audio.processor?.disconnect();
    audio.source?.disconnect();
    audio.stream?.getTracks()?.forEach((t) => t.stop());
    audio.context?.close?.();
    audioRef.current = { stream: null, context: null, processor: null, source: null };
  }

  function teardownSession() {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* ignore */
      }
      ws.close();
    }
    wsRef.current = null;
    teardownAudio();
    stopMicTest();
  }

  function stopMicTest() {
    micTestRef.current?.stop?.();
    micTestRef.current = null;
    setMicLevel(0);
  }

  function connectWs() {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve(wsRef.current);
        return;
      }
      const ws = new WebSocket(
        `${getWsBase()}/ws/session?mode=realtime&token=${encodeURIComponent(getAuthToken())}`
      );
      wsRef.current = ws;
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error("WebSocket 连接失败"));
      ws.onclose = () => {
        if (phase === "active") {
          setStatusKind("idle");
          setStatusText("连接已断开");
        }
      };
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        handleWsMessage(data);
      };
    });
  }

  function handleWsMessage(data) {
    if (data.type === "ready") {
      setStatusText("通道已就绪");
      return;
    }
    if (data.type === "info") {
      const text = data.text || "";
      if (text.includes("生成提纲")) {
        setStatusKind("generating");
        setStatusText("生成中");
        setAnsStatus("生成中…");
      } else if (text.includes("监听")) {
        setStatusKind("listening");
        setStatusText("监听中");
      } else {
        setStatusText(text);
      }
      return;
    }
    if (data.type === "question_detected") {
      const q = data.question || data.text || "";
      setCurrentQuestion(q);
      setPartialText("");
      setCurrentOutline(null);
      questionSourceRef.current = "asr";
      setStatusKind("generating");
      setStatusText("生成中");
      setAnsStatus("生成中…");
      if (q) appendChat("面试官", q);
      return;
    }
    if (data.type === "transcript") {
      setPartialText(data.text || "");
      questionSourceRef.current = "asr";
      setStatusKind("recognizing");
      setStatusText("识别中");
      return;
    }
    if (data.type === "answer") {
      const q = data.question || "";
      const outline = data.outline;
      const item = {
        question: q,
        outline,
        at: Date.now(),
        source: questionSourceRef.current === "manual" ? "manual" : "asr",
      };
      setCurrentQuestion(q);
      setCurrentOutline(outline);
      setPartialText("");
      setHistory((prev) => [...prev, item]);
      setStatusKind("listening");
      setStatusText("监听中");
      setAnsStatus("已生成");
      setChat((prev) => {
        const last = prev[prev.length - 1];
        if (q && (!last || last.text !== q)) return [...prev, { who: "面试官", text: q, at: Date.now() }];
        return prev;
      });
      return;
    }
    if (data.type === "error") {
      setError(data.text || "服务错误");
      setStatusKind("listening");
      setStatusText("监听中");
      setAnsStatus("");
    }
  }

  async function startCapture(ws) {
    teardownAudio();
    if (audioSource === "system") {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const tracks = stream.getAudioTracks();
      if (!tracks.length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("未捕获到系统音频，请勾选「分享音频」或改用麦克风");
      }
      stream.getVideoTracks().forEach((t) => t.stop());
      await bindAudioStream(new MediaStream([tracks[0]]), ws);
      return;
    }
    const constraints = micId ? { audio: { deviceId: { exact: micId } } } : { audio: true };
    const mic = await navigator.mediaDevices.getUserMedia(constraints);
    await bindAudioStream(mic, ws);
  }

  async function bindAudioStream(stream, ws) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const down = downsample(input, context.sampleRate, TARGET_SAMPLE_RATE);
      ws.send(floatTo16BitPCM(down));
    };
    source.connect(processor);
    processor.connect(context.destination);
    audioRef.current = { stream, context, processor, source };
  }

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const mics = list.filter((d) => d.kind === "audioinput");
      const spks = list.filter((d) => d.kind === "audiooutput");
      setMicDevices(mics);
      setSpkDevices(spks);
      if (!micId && mics[0]) setMicId(mics[0].deviceId);
      if (!spkId && spks[0]) setSpkId(spks[0].deviceId);
    } catch {
      /* ignore */
    }
  }

  function openModal() {
    setResumes(getResumes() || []);
    setModalStep(1);
    setModalOpen(true);
    setLangOpen(false);
    setJobOpen(false);
    setError("");
    refreshDevices();
  }

  function closeModal() {
    setModalOpen(false);
    setLangOpen(false);
    setJobOpen(false);
    stopMicTest();
  }

  function validateConfig() {
    if (!jobL1 || !jobL2) {
      showToast("请选择职位类型");
      return false;
    }
    if (!langs.length) {
      showToast("请选择编程语言");
      return false;
    }
    if (!agree) {
      showToast("请先同意用户服务协议");
      return false;
    }
    return true;
  }

  async function startListening() {
    const resume = resumes.find((r) => r.id === resumeId);
    const jobTypeLabel = `${jobL1} > ${jobL2}`;
    const snap = {
      resumeId,
      resumeLabel: resume?.name || resume?.title || (resumeId ? "已选简历" : "未选简历"),
      jdText: jdText.trim(),
      kb,
      jobType: jobTypeLabel,
      jobL1,
      jobL2,
      langs: [...langs],
      audioSource,
    };
    setConfigSnap(snap);
    setError("");
    setHistory([]);
    setChat([]);
    setCurrentQuestion("");
    setCurrentOutline(null);
    setPartialText("");
    setStealth(false);
    setAnsStatus("");
    setStartedAt(Date.now());
    setModalOpen(false);
    try {
      const ws = await connectWs();
      ws.send(
        JSON.stringify({
          type: "start",
          answer_mode: "outline",
          jd_text: snap.jdText,
        })
      );
      try {
        await startCapture(ws);
        showToast(audioSource === "system" ? "已开始捕获系统音频" : "已开始麦克风监听");
      } catch (err) {
        setError(`${err.message}（仍可用右下角文本提问）`);
        showToast("音频未就绪，可用文本提问");
      }
      setPhase("active");
      setStatusKind("listening");
      setStatusText("监听中");
      appendChat("系统", `已载入「${snap.resumeLabel}」，开始监听。`);
    } catch (err) {
      setError("启动失败：" + err.message);
      setModalOpen(true);
      setModalStep(2);
    }
  }

  function endSession(opts = {}) {
    if (!opts.fromBack && window.history.state?.rtInterviewGuard) {
      backIgnoreRef.current = true;
      window.history.back();
    }
    const at = startedAt || Date.now();
    const timeLabel = formatInterviewTime(at) || "刚刚";
    const items = history.map((h) => ({
      question: h.question || "",
      answer: resolveAnswer(h.outline) || outlineToText(h.outline) || "",
      outline: h.outline || null,
      source: h.source || "",
      at: h.at || null,
    }));
    const rec = {
      id: `rt_${Date.now()}`,
      jobType: configSnap?.jobType || "面试",
      resumeLabel: configSnap?.resumeLabel || "",
      langs: configSnap?.langs || [],
      kb: configSnap?.kb || "none",
      time: timeLabel,
      qCount: items.length,
      at,
      items,
    };
    const next = [rec, ...records];
    setRecords(next);
    saveRecords(next);
    teardownSession();
    setPhase("home");
    setStatusKind("idle");
    setStatusText("已结束");
    setStealth(false);
    showToast("已保存本场面试记录");
  }
  endSessionRef.current = endSession;

  function openReview(index) {
    const rec = records[index];
    if (!rec) return;
    setReportRec(rec);
    setPhase("report");
  }

  function sendSimulate() {
    const text = simInput.trim();
    if (!text) {
      showToast("请输入问题");
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("未连接，请重新开始面试");
      return;
    }
    questionSourceRef.current = "manual";
    setCurrentQuestion(text);
    setCurrentOutline(null);
    setPartialText("");
    appendChat("面试官", text);
    ws.send(JSON.stringify({ type: "simulate", text }));
    setSimInput("");
    setStatusKind("generating");
    setStatusText("生成中");
    setAnsStatus("生成中…");
  }

  async function onUploadResume(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast("正在解析简历…");
      const data = await api.uploadFile(file);
      if (data.error) {
        showToast(data.error);
        return;
      }
      setResumes(getResumes() || []);
      showToast(`解析完成，共 ${data.count || 0} 条素材`);
    } catch (err) {
      showToast(err.message || "上传失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function testMic() {
    stopMicTest();
    try {
      const constraints = micId ? { audio: { deviceId: { exact: micId } } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let alive = true;
      function tick() {
        if (!alive) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 80) * 100)));
        requestAnimationFrame(tick);
      }
      tick();
      setMicHint("正在测试，请对着麦克风说话…");
      micTestRef.current = {
        stop() {
          alive = false;
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
        },
      };
      window.setTimeout(() => {
        stopMicTest();
        setMicHint("麦克风测试完成");
        showToast("麦克风正常");
      }, 4000);
    } catch (err) {
      setMicHint("无法打开麦克风：" + err.message);
    }
  }

  async function testSpk() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setSpkHint("正在播放提示音…");
      window.setTimeout(() => {
        osc.stop();
        ctx.close();
        setSpkHint("扬声器测试完成");
        showToast("扬声器正常");
      }, 600);
    } catch (err) {
      setSpkHint("测试失败：" + err.message);
    }
  }

  function bindHSplit(e, bottomEl, containerEl, minBottom, maxRatio) {
    e.preventDefault();
    document.body.classList.add("rt-v2-resizing-h");
    const startY = e.clientY;
    const startH = bottomEl.getBoundingClientRect().height;
    const boxH = containerEl.getBoundingClientRect().height;
    function onMove(ev) {
      const dy = startY - ev.clientY;
      let next = startH + dy;
      next = Math.max(minBottom, Math.min(boxH * maxRatio, next));
      bottomEl.style.height = `${next}px`;
    }
    function onUp() {
      document.body.classList.remove("rt-v2-resizing-h");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function onSplitV(e) {
    e.preventDefault();
    const left = leftRef.current;
    const workspace = workspaceRef.current;
    if (!left || !workspace) return;
    document.body.classList.add("rt-v2-resizing");
    const startX = e.clientX;
    const startW = left.getBoundingClientRect().width;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      const total = workspace.getBoundingClientRect().width;
      let next = startW + dx;
      next = Math.max(280, Math.min(total - 288, next));
      left.style.width = `${next}px`;
    }
    function onUp() {
      document.body.classList.remove("rt-v2-resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const displayQuestion = currentQuestion || partialText;

  return (
    <div className={`rt-v2-shell${phase === "active" ? " rt-v2-active" : ""}`}>
      {phase === "home" && (
        <div className="rt-v2-home">
          <div className="rt-v2-home-toolbar">
            <button type="button" className="btn primary" onClick={openModal}>
              + 新建面试
            </button>
          </div>
          {!records.length ? (
            <div className="rt-v2-home-empty">
              <h2>欢迎使用面试助手，点击新建面试，即刻开始面试之旅，祝你好运连连</h2>
              <p>配置简历与 JD 后，即可开启实时识别与参考回答</p>
            </div>
          ) : (
            <div className="rt-v2-home-grid">
              {records.map((r, i) => {
                const timeLabel = formatInterviewTime(r.at) || r.time || "";
                return (
                  <div className="rt-v2-rec-card mk-rec-card" key={r.id}>
                    <h3>{r.jobType || "未命名面试"}</h3>
                    <div className="rt-v2-rec-tags">
                      <span className="rt-v2-tag">{r.resumeLabel || "简历"}</span>
                      {(r.langs || []).map((x) => (
                        <span className="rt-v2-tag" key={x}>
                          {x}
                        </span>
                      ))}
                    </div>
                    <div className="rt-v2-rec-meta">
                      {timeLabel ? `${timeLabel} · ` : ""}
                      {r.qCount || 0} 题
                    </div>
                    <div className="mk-rec-foot">
                      <button type="button" className="btn primary" onClick={() => openReview(i)}>
                        复盘
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {phase === "report" && reportRec && (
        <div className="rt-v2-home">
          <div className="mk-report-toolbar">
            <button type="button" className="btn" onClick={() => setPhase("home")}>
              ← 返回首页
            </button>
            <strong>{reportRec.jobType || "实时辅助"} · 复盘</strong>
            <span />
          </div>
          <div className="mk-report-hero">
            <div>
              <div className="mk-report-score">
                {reportRec.qCount || reportRec.items?.length || 0}
                <small> 题</small>
              </div>
              <div className="mk-report-sub">本场识别问题</div>
            </div>
            <div className="mk-report-summary">
              <div className="mk-report-summary-title">面试回看</div>
              <p>
                {formatInterviewTime(reportRec.at) || reportRec.time || "—"}
                {reportRec.resumeLabel ? ` · ${reportRec.resumeLabel}` : ""}
              </p>
            </div>
          </div>
          <h3 className="mk-report-h3">逐题回看</h3>
          {(reportRec.items || []).length ? (
            (reportRec.items || []).map((item, idx) => (
              <div className="mk-report-card" key={idx}>
                <h4>
                  {idx + 1}. {item.question || "（无题目）"}
                </h4>
                <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  AI 参考：{item.answer || resolveAnswer(item.outline) || outlineToText(item.outline) || "（无参考回答）"}
                </p>
              </div>
            ))
          ) : (
            <div className="card">
              <p className="muted">本场暂无题目记录（旧记录未保存明细，新完测后可复盘）。</p>
            </div>
          )}
        </div>
      )}

      {phase === "active" && (
        <div className="rt-v2-interview">
          <div className="rt-v2-iv-top">
            <div className="left">
              <span className="rt-v2-dot" />
              <strong>面试进行中</strong>
              <span className="rt-v2-chip">{formatElapsed(elapsedMs)}</span>
              <span className="rt-v2-iv-tag">{configSnap?.jobType || "—"}</span>
              {(configSnap?.langs || []).map((x) => (
                <span className="rt-v2-iv-tag" key={x}>
                  {x}
                </span>
              ))}
              <span className={`rt-status-pill ${statusKind}`}>
                <span className="rt-dot" />
                <span>{statusText}</span>
              </span>
            </div>
            <div className="right">
              <button type="button" className="btn ghost" onClick={() => setStealth((v) => !v)}>
                {stealth ? "显示浮窗" : "隐身浮窗"}
              </button>
              <button type="button" className="btn primary" onClick={endSession}>
                结束面试
              </button>
            </div>
          </div>
          {error && <p className="rt-v2-error">{error}</p>}
          <div className="rt-v2-workspace" ref={workspaceRef}>
            <div className="rt-v2-left" ref={leftRef}>
              <section className="rt-v2-panel rt-v2-chat-panel">
                <div className="rt-v2-panel-bd" ref={chatScrollRef}>
                  <div className="rt-v2-chat">
                    {chat.map((m, i) => (
                      <div
                        key={`${m.at}-${i}`}
                        className={`rt-v2-bubble ${m.who === "面试官" ? "interviewer" : m.who === "系统" ? "system" : "candidate"}`}
                      >
                        <div className="who">{m.who}</div>
                        {m.text}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
              <div
                className="rt-v2-split-h"
                title="拖拽调整高度"
                onMouseDown={(e) => bindHSplit(e, qPanelRef.current, leftRef.current, 72, 0.55)}
              />
              <section className="rt-v2-panel rt-v2-q-panel" ref={qPanelRef}>
                <div className="rt-v2-panel-bd">
                  <div className={`rt-v2-q-now${!displayQuestion ? " empty" : ""}`}>
                    {displayQuestion || "等待识别面试官问题…"}
                  </div>
                </div>
              </section>
            </div>

            <div className="rt-v2-split-v" title="拖拽调整宽度" onMouseDown={onSplitV} />

            <div className="rt-v2-right">
              <div className="rt-v2-warn">
                AI 生成回答，仅供参考，请仔细甄别{" "}
                <span style={{ fontWeight: 400 }}>{ansStatus}</span>
              </div>
              <section className="rt-v2-panel rt-v2-ans-panel">
                <div className="rt-v2-panel-bd">
                  <AnswerBody outline={currentOutline} />
                </div>
              </section>
              <div
                className="rt-v2-split-h"
                title="拖拽调整高度"
                onMouseDown={(e) => {
                  const right = e.currentTarget.parentElement;
                  bindHSplit(e, composerRef.current, right, 72, 0.4);
                }}
              />
              <section className="rt-v2-panel rt-v2-composer-panel" ref={composerRef}>
                <div className="rt-v2-composer">
                  <textarea
                    id="manual-q"
                    value={simInput}
                    onChange={(e) => setSimInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendSimulate();
                      }
                    }}
                    placeholder="如遇突发状况，在此提问，开启 AI 辅助回答"
                  />
                  <button type="button" className="btn primary" onClick={sendSimulate}>
                    发送
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className="rt-v2-mask"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="rt-v2-modal" role="dialog" aria-modal="true">
            <div className="rt-v2-modal-hd">
              <h2>{modalStep === 1 ? "新建面试" : "音视频配置"}</h2>
              <button type="button" className="rt-v2-modal-x" onClick={closeModal} aria-label="关闭">
                ×
              </button>
            </div>
            {modalStep === 1 ? (
              <div className="rt-v2-modal-bd">
                <div className="rt-v2-form-row">
                  <label>面试简历</label>
                  <div className="rt-v2-field-inline">
                    <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                      <option value="">选择简历</option>
                      {resumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || r.title || r.id}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                      上传
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,.txt,.md"
                      onChange={onUploadResume}
                    />
                  </div>
                </div>
                <div className="rt-v2-form-row">
                  <label>面试 JD</label>
                  <textarea
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    placeholder="粘贴目标岗位 JD…"
                  />
                </div>
                <div className="rt-v2-form-row">
                  <label>定制知识库</label>
                  <select value={kb} onChange={(e) => setKb(e.target.value)}>
                    <option value="none">不使用知识库</option>
                    <option value="lib">使用我的资料库</option>
                    <option value="exp">使用我的经历</option>
                  </select>
                </div>
                <div className="rt-v2-form-row">
                  <label>
                    职位类型<span className="rt-v2-req">*</span>
                  </label>
                  <JobTypeSelect
                    l1={jobL1}
                    l2={jobL2}
                    open={jobOpen}
                    setOpen={(v) => {
                      setJobOpen(v);
                      if (v) setLangOpen(false);
                    }}
                    onChange={(nextL1, nextL2) => {
                      setJobL1(nextL1);
                      setJobL2(nextL2);
                      const presets = JOB_LANG_PRESETS[nextL1];
                      if (presets) setLangs(presets.length ? [...presets] : ["无"]);
                    }}
                  />
                </div>
                <div className="rt-v2-form-row">
                  <label>
                    编程语言<span className="rt-v2-req">*</span>
                  </label>
                  <LangMultiSelect
                    value={langs}
                    onChange={setLangs}
                    open={langOpen}
                    setOpen={(v) => {
                      setLangOpen(v);
                      if (v) setJobOpen(false);
                    }}
                    query={langQuery}
                    setQuery={setLangQuery}
                  />
                </div>
                <label className="rt-v2-agree mk-agree-center">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>
                    我已阅读并同意{" "}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        showToast("协议页稍后接入");
                      }}
                    >
                      白猫面试用户服务协议
                    </a>
                  </span>
                </label>
              </div>
            ) : (
              <div className="rt-v2-modal-bd">
                <div className="rt-v2-av-block">
                  <h3>音频来源</h3>
                  <div className="rt-v2-av-row">
                    <select value={audioSource} onChange={(e) => setAudioSource(e.target.value)}>
                      <option value="system">系统音频（推荐）</option>
                      <option value="mic">仅麦克风</option>
                    </select>
                  </div>
                  <p className="rt-v2-av-hint">
                    {audioSource === "system"
                      ? "开始后面试时需共享标签页/窗口并勾选「分享音频」"
                      : "外放可用；耳机面试可能听不到对方"}
                  </p>
                </div>
                <div className="rt-v2-av-block">
                  <h3>麦克风</h3>
                  <div className="rt-v2-av-row">
                    <select value={micId} onChange={(e) => setMicId(e.target.value)}>
                      {!micDevices.length && <option value="">默认麦克风</option>}
                      {micDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "麦克风"}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn" onClick={testMic}>
                      测试
                    </button>
                  </div>
                  <div className="rt-v2-level">
                    <i style={{ width: `${micLevel}%` }} />
                  </div>
                  <p className="rt-v2-av-hint">{micHint}</p>
                </div>
                <div className="rt-v2-av-block">
                  <h3>扬声器</h3>
                  <div className="rt-v2-av-row">
                    <select value={spkId} onChange={(e) => setSpkId(e.target.value)}>
                      {!spkDevices.length && <option value="">默认扬声器</option>}
                      {spkDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "扬声器"}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn" onClick={testSpk}>
                      测试
                    </button>
                  </div>
                  <p className="rt-v2-av-hint">{spkHint}</p>
                </div>
              </div>
            )}
            <div className="rt-v2-modal-ft">
              <a
                className="rt-v2-help"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  showToast("帮助页稍后接入");
                }}
              >
                如何在面试中使用?
              </a>
              <div className="right">
                {modalStep === 2 && (
                  <button type="button" className="btn ghost" onClick={() => setModalStep(1)}>
                    上一步
                  </button>
                )}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    if (modalStep === 1) {
                      if (!validateConfig()) return;
                      setModalStep(2);
                      refreshDevices();
                      return;
                    }
                    startListening();
                  }}
                >
                  {modalStep === 1 ? "下一步" : "开始面试"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <FloatWin
        visible={phase === "active"}
        stealth={stealth}
        question={currentQuestion}
        outline={currentOutline}
        onStealth={() => setStealth((v) => !v)}
        onEnd={endSession}
        dragRef={floatRef}
      />

      {toast && (
        <div className="rt-toast show">
          <span className="rt-toast-icon" aria-hidden="true">
            !
          </span>
          <span className="rt-toast-text">{toast}</span>
        </div>
      )}
    </div>
  );
}
