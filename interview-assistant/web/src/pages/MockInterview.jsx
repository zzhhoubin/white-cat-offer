import { useEffect, useRef, useState } from "react";
import { api, getAuthToken, getWsBase } from "../api.js";
import JobTypeSelect from "../components/JobTypeSelect.jsx";
import { getResumes } from "./resumeGrower/storage.js";

const TARGET_SAMPLE_RATE = 16000;
const RECORDS_KEY = "mock_interview_records_v1";
const LANG_OPTIONS = ["无", "Python", "SQL", "Java", "JavaScript", "TypeScript", "Go", "C++", "R", "Scala"];
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

function outlineToDisplay(outline) {
  if (!outline) return "";
  if (typeof outline === "string") return outline;
  const parts = [];
  if (outline.intent) parts.push(`考察意图：${outline.intent}`);
  if (outline.structure?.length) parts.push(`结构：\n${outline.structure.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
  if (outline.example) parts.push(`示范：${outline.example}`);
  if (outline.keywords?.length) parts.push(`关键词：${outline.keywords.join("、")}`);
  if (outline.personal_refs?.length) parts.push(`可引用：${outline.personal_refs.join(" · ")}`);
  return parts.join("\n\n") || "暂无参考";
}

function normalizeQuestion(data) {
  if (!data) return null;
  const q = data.next_question || data;
  if (!q?.question) return null;
  return {
    id: q.item_id || q.question_id || `q_${Date.now()}`,
    question: q.question,
    intent: q.intent || "",
    roundLabel: q.round_label || "",
    index: q.index || 0,
    total: q.total || 0,
    answer: "",
    draft: "",
    status: "current",
    outlineText: "",
  };
}

function toggleLangSelection(prev, lang) {
  if (lang === "无") return ["无"];
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
      pop.style.left = `${Math.max(8, rect.left)}px`;
      pop.style.width = `${rect.width}px`;
      pop.style.top = `${rect.bottom + 4}px`;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
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
        <div className="rt-v2-ms-pop" ref={popRef}>
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
                    onClick={() => onChange(toggleLangSelection(value, lang))}
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

export default function MockInterview() {
  const [phase, setPhase] = useState("home");
  const [records, setRecords] = useState(() => loadRecords());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(1);

  const [resumes, setResumes] = useState([]);
  const [resumeId, setResumeId] = useState("");
  const [resumeReady, setResumeReady] = useState(false);
  const [assetCount, setAssetCount] = useState(0);
  const [jdText, setJdText] = useState("");
  const [kb, setKb] = useState("none");
  const [jobL1, setJobL1] = useState("");
  const [jobL2, setJobL2] = useState("");
  const [jobL3, setJobL3] = useState("");
  const [jobOpen, setJobOpen] = useState(false);
  const [langs, setLangs] = useState(["无"]);
  const [langOpen, setLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [agree, setAgree] = useState(false);

  const [micDevices, setMicDevices] = useState([]);
  const [spkDevices, setSpkDevices] = useState([]);
  const [micId, setMicId] = useState("");
  const [spkId, setSpkId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [micHint, setMicHint] = useState("点击测试后说话，查看电平");
  const [spkHint, setSpkHint] = useState("点击测试播放提示音");

  const [configSnap, setConfigSnap] = useState(null);
  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [viewingIdx, setViewingIdx] = useState(0);
  const [pendingNext, setPendingNext] = useState(null);
  const [bankDone, setBankDone] = useState(false);
  const [interviewActive, setInterviewActive] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const [refLoading, setRefLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [startedAt, setStartedAt] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [reportRec, setReportRec] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  const fileRef = useRef(null);
  const leftRef = useRef(null);
  const workspaceRef = useRef(null);
  const composerRef = useRef(null);
  const qListScrollRef = useRef(null);
  const micTestRef = useRef(null);
  const backIgnoreRef = useRef(false);
  const endSessionRef = useRef(null);
  const wsRef = useRef(null);
  const voiceReadyRef = useRef(false);
  const audioRef = useRef({ stream: null, context: null, processor: null, source: null });
  const answerRef = useRef("");

  const currentQ = questions[viewingIdx] || null;
  const isCurrent = viewingIdx === currentIdx && interviewActive;

  useEffect(() => {
    setResumes(getResumes() || []);
    api
      .config()
      .then((data) => setVoiceEnabled(data.mock_interview_voice_enabled !== false))
      .catch(() => setVoiceEnabled(true));
    api
      .getAssets()
      .then((data) => {
        setAssetCount((data.assets || []).length);
        setResumeReady(Boolean(data.resume_text || (data.assets || []).length));
      })
      .catch(() => {});
    return () => stopVoice();
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
    window.history.pushState({ mkInterviewGuard: true }, "");
    function onPop() {
      if (backIgnoreRef.current) {
        backIgnoreRef.current = false;
        return;
      }
      const ok = window.confirm("正在进行面试，确认要退出");
      if (ok) endSessionRef.current?.({ fromBack: true });
      else window.history.pushState({ mkInterviewGuard: true }, "");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [phase]);

  useEffect(() => {
    if (qListScrollRef.current && viewingIdx === currentIdx) qListScrollRef.current.scrollTop = 0;
  }, [questions.length, currentIdx, viewingIdx]);

  function showToast(msg) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 1700);
  }

  function stopMicTest() {
    micTestRef.current?.stop?.();
    micTestRef.current = null;
    setMicLevel(0);
  }

  function stopVoice() {
    const audio = audioRef.current;
    audio.processor?.disconnect();
    audio.source?.disconnect();
    audio.stream?.getTracks()?.forEach((t) => t.stop());
    audio.context?.close?.();
    audioRef.current = { stream: null, context: null, processor: null, source: null };
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      }, 400);
    }
    wsRef.current = null;
    voiceReadyRef.current = false;
    setVoiceOn(false);
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
    setJobOpen(false);
    setLangOpen(false);
    refreshDevices();
  }

  function closeModal() {
    setModalOpen(false);
    setJobOpen(false);
    setLangOpen(false);
    stopMicTest();
  }

  function validateConfig() {
    if (!resumeId) {
      showToast("请选择面试简历");
      return false;
    }
    if (!jobL1 || !jobL2 || !jobL3) {
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
      setAssetCount((data.assets || []).length);
      setResumeReady(true);
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

  async function startInterview() {
    const resume = resumes.find((r) => r.id === resumeId);
    const jobType = `${jobL1} > ${jobL2} > ${jobL3}`;
    const snap = {
      resumeId,
      resumeLabel: resume?.name || (resumeId ? "已选简历" : `素材 ${assetCount} 条`),
      jdText: jdText.trim(),
      kb,
      jobType,
      jobL1,
      jobL2,
      jobL3,
      langs: [...langs],
    };
    setConfigSnap(snap);
    setBusy(true);
    try {
      try {
        const cfg = await api.config();
        if (!cfg.llm_configured) {
          showToast("未配置 LLM API Key，请先在「我的 → AI 服务商」填写并设为默认");
          return;
        }
      } catch {
        /* 预检失败不阻断，交由创建接口返回 */
      }
      const created = await api.createMockInterview({
        role: jobL3 || jobL2 || jobType,
        jd_text: snap.jdText || "（未填写 JD）",
        company_name: "",
        language: "zh",
        scope: "full",
      });
      if (created.error) {
        showToast(created.error);
        return;
      }
      const sid = created.session.session_id;
      setSession(created.session);
      const firstData = await api.nextMockInterviewQuestion(sid);
      if (firstData.error) {
        showToast(firstData.error);
        return;
      }
      if (firstData.done) {
        showToast("暂无题目可出");
        return;
      }
      const first = normalizeQuestion(firstData);
      if (!first) {
        showToast("出题失败");
        return;
      }
      setQuestions([first]);
      setCurrentIdx(0);
      setViewingIdx(0);
      setPendingNext(null);
      setBankDone(false);
      setInterviewActive(true);
      setShowRef(false);
      setStartedAt(Date.now());
      setModalOpen(false);
      setPhase("active");
      answerRef.current = "";
    } catch (err) {
      showToast("启动失败：" + err.message);
    } finally {
      setBusy(false);
    }
  }

  function appendQuestion(nextQ) {
    setQuestions((prev) => {
      const copy = prev.map((q) =>
        q.status === "current"
          ? { ...q, status: "done", draft: answerRef.current || q.draft || "" }
          : q
      );
      const next = [...copy, { ...nextQ, status: "current" }];
      setCurrentIdx(next.length - 1);
      setViewingIdx(next.length - 1);
      return next;
    });
    setShowRef(false);
    answerRef.current = "";
    stopVoice();
  }

  async function goNext() {
    if (viewingIdx < currentIdx) {
      setViewingIdx((i) => i + 1);
      setShowRef(false);
      return;
    }
    if (!interviewActive) {
      showToast("面试已结束，不再出题");
      return;
    }
    if (busy) return;

    setQuestions((prev) =>
      prev.map((q, i) => (i === currentIdx ? { ...q, draft: answerRef.current } : q))
    );

    if (pendingNext) {
      const next = pendingNext;
      setPendingNext(null);
      appendQuestion(next);
      return;
    }
    if (bankDone) {
      await finishAndGoHome({ skipConfirm: true });
      return;
    }

    const cur = questions[currentIdx];
    const hasSubmit = !!(cur?.answer || "").trim();
    // 已提交且等待中的下一题应走 pendingNext；此处仅处理未提交跳过
    if (hasSubmit) {
      showToast("正在同步下一题…");
    }

    setBusy(true);
    try {
      const data = hasSubmit
        ? await api.nextMockInterviewQuestion(session.session_id)
        : await api.skipMockInterviewQuestion(session.session_id);
      if (data.error && !data.done) {
        showToast(data.error);
        return;
      }
      if (data.session) setSession(data.session);
      if (data.done) {
        const updated = questions.map((q) =>
          q.status === "current" ? { ...q, status: "done", draft: answerRef.current || q.draft || "" } : q
        );
        setQuestions(updated);
        setBankDone(true);
        await finishAndGoHome({
          skipConfirm: true,
          questionsOverride: updated,
          sessionOverride: data.session || session,
        });
        return;
      }
      const next = normalizeQuestion(data.next_question || data);
      if (!next) {
        showToast("获取下一题失败");
        return;
      }
      appendQuestion(next);
    } catch (err) {
      showToast("下一题失败：" + err.message);
    } finally {
      setBusy(false);
    }
  }

  function goPrev() {
    if (viewingIdx <= 0) return;
    if (viewingIdx === currentIdx) {
      setQuestions((prev) => prev.map((q, i) => (i === currentIdx ? { ...q, draft: answerRef.current } : q)));
    }
    setViewingIdx((i) => i - 1);
    setShowRef(false);
    stopVoice();
  }

  async function submitAnswer() {
    if (!isCurrent || !session?.session_id) {
      showToast("请回到当前问题再提交");
      return;
    }
    const text = (answerRef.current || currentQ?.draft || "").trim();
    if (!text) {
      showToast("请先输入回答");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const data = await api.submitMockInterviewAnswer(session.session_id, text);
      if (data.error && !data.done) {
        showToast(data.error);
        return;
      }
      if (data.session) setSession(data.session);
      const updated = questions.map((q, i) =>
        i === currentIdx ? { ...q, answer: text, draft: text, status: data.done ? "done" : q.status } : q
      );
      setQuestions(updated);
      if (data.done) {
        setBankDone(true);
        setPendingNext(null);
        await finishAndGoHome({
          skipConfirm: true,
          questionsOverride: updated,
          sessionOverride: data.session || session,
        });
        return;
      }
      const next = data.next_question ? normalizeQuestion(data.next_question) : null;
      if (next) setPendingNext(next);
      showToast("本题已提交");
    } catch (err) {
      showToast("提交失败：" + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRef() {
    if (showRef) {
      setShowRef(false);
      return;
    }
    const q = questions[viewingIdx];
    if (!q) return;
    if (q.outlineText) {
      setShowRef(true);
      return;
    }
    if (viewingIdx !== currentIdx || !session?.session_id) {
      showToast("仅当前题可拉取参考");
      return;
    }
    setRefLoading(true);
    try {
      const data = await api.fetchMockInterviewOutline(session.session_id);
      if (data.error) {
        showToast(data.error);
        return;
      }
      const text = outlineToDisplay(data.outline);
      setQuestions((prev) => prev.map((item, i) => (i === viewingIdx ? { ...item, outlineText: text } : item)));
      setShowRef(true);
    } catch (err) {
      showToast("获取参考失败：" + err.message);
    } finally {
      setRefLoading(false);
    }
  }

  function connectVoiceWs() {
    if (wsRef.current?.readyState === WebSocket.OPEN && voiceReadyRef.current) {
      return Promise.resolve(wsRef.current);
    }
    return new Promise((resolve, reject) => {
      voiceReadyRef.current = false;
      const ws = new WebSocket(`${getWsBase()}/ws/session?mode=mock&token=${encodeURIComponent(getAuthToken())}`);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "start" }));
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "transcript" && data.text) {
          answerRef.current = data.text;
          setQuestions((prev) => prev.map((q, i) => (i === currentIdx ? { ...q, draft: data.text } : q)));
        }
        if (data.type === "info" && (data.text || "").includes("会话已开始")) {
          voiceReadyRef.current = true;
          resolve(ws);
        }
        if (data.type === "error") reject(new Error(data.text || "语音服务错误"));
      };
      ws.onerror = () => reject(new Error("WebSocket 连接失败"));
      ws.onclose = () => {
        voiceReadyRef.current = false;
        setVoiceOn(false);
      };
    });
  }

  async function toggleVoice() {
    if (!isCurrent) return;
    if (!voiceEnabled) {
      showToast("语音功能未开启");
      return;
    }
    if (voiceOn) {
      stopVoice();
      return;
    }
    try {
      const ws = await connectVoiceWs();
      const constraints = micId ? { audio: { deviceId: { exact: micId } } } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (ws.readyState !== WebSocket.OPEN || !voiceReadyRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const down = downsample(input, context.sampleRate, TARGET_SAMPLE_RATE);
        ws.send(floatTo16BitPCM(down));
      };
      source.connect(processor);
      processor.connect(context.destination);
      audioRef.current = { stream, context, processor, source };
      setVoiceOn(true);
      showToast("正在语音转写…");
    } catch (err) {
      showToast("无法启动麦克风：" + err.message);
      stopVoice();
    }
  }

  async function finishAndGoHome(opts = {}) {
    if (!opts.skipConfirm) {
      const msg = opts.fromBack ? "正在进行面试，确认要退出" : "确认结束本场模拟面试？";
      if (!window.confirm(msg)) return;
    }
    if (!opts.fromBack && window.history.state?.mkInterviewGuard) {
      backIgnoreRef.current = true;
      window.history.back();
    }
    setInterviewActive(false);
    stopVoice();
    setBusy(true);
    const qs = opts.questionsOverride || questions;
    let finishedSession = opts.sessionOverride || session;
    try {
      let report = finishedSession?.report || null;
      if (finishedSession?.session_id) {
        const data = await api.finishMockInterview(finishedSession.session_id);
        if (!data.error) {
          finishedSession = data.session || finishedSession;
          report = data.session?.report || data.report || report;
        }
      }
      const answered = qs.filter((q) => (q.answer || "").trim()).length;
      const sid = finishedSession?.session_id || null;
      const at = startedAt || Date.now();
      const timeLabel = formatInterviewTime(at) || "刚刚";
      const rec = {
        id: sid || `mk_${Date.now()}`,
        jobType: configSnap?.jobType || "模拟面试",
        resumeLabel: configSnap?.resumeLabel || "",
        langs: configSnap?.langs || [],
        time: timeLabel,
        at,
        answered,
        total: qs.length,
        questions: qs.map((q) => ({
          q: q.question,
          answer: (q.answer || q.draft || "").trim(),
        })),
        sessionId: sid,
        report,
      };
      const rest = sid
        ? records.filter((r) => r.sessionId !== sid && r.id !== sid)
        : records;
      const next = [rec, ...rest];
      setRecords(next);
      saveRecords(next);
      setPhase("home");
      setSession(null);
      setQuestions([]);
      setPendingNext(null);
      setBankDone(false);
      setShowRef(false);
      setCurrentIdx(0);
      setViewingIdx(0);
      showToast(opts.toastMsg || "本场已结束，记录已保存；报告生成中，可稍后点「复盘」查看");
    } catch (err) {
      showToast("结束失败：" + err.message);
      setPhase("home");
    } finally {
      setBusy(false);
    }
  }
  endSessionRef.current = finishAndGoHome;

  async function openReview(index) {
    const rec = records[index];
    if (!rec) return;
    setReportRec(rec);
    setPhase("report");
    if (rec.report) return;
    if (!rec.sessionId) return;
    setReportLoading(true);
    try {
      const data = await api.getMockInterviewReport(rec.sessionId);
      const report = data.report || data.session?.report || null;
      if (report) {
        const next = records.map((r, i) => (i === index ? { ...r, report } : r));
        setRecords(next);
        saveRecords(next);
        setReportRec({ ...rec, report });
      }
    } catch {
      /* keep local mock-less */
    } finally {
      setReportLoading(false);
    }
  }

  function bindHSplit(e, bottomEl, containerEl, minBottom, maxRatio) {
    e.preventDefault();
    document.body.classList.add("rt-v2-resizing-h");
    const startY = e.clientY;
    const startH = bottomEl.getBoundingClientRect().height;
    const boxH = containerEl.getBoundingClientRect().height;
    function onMove(ev) {
      let next = startH + (startY - ev.clientY);
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
      const total = workspace.getBoundingClientRect().width;
      let next = startW + (ev.clientX - startX);
      next = Math.max(260, Math.min(total - 288, next));
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

  const visibleQuestions = questions
    .map((item, i) => ({ item, i }))
    .slice()
    .reverse();
  const answeredCount = questions.filter((q) => (q.answer || "").trim()).length;
  const displayText = isCurrent
    ? currentQ?.draft || currentQ?.answer || ""
    : currentQ?.answer || currentQ?.draft || "";
  const report = reportRec?.report;

  return (
    <div className={`rt-v2-shell${phase === "active" ? " rt-v2-active" : ""}`}>
      {phase === "home" && (
        <div className="rt-v2-home">
          <div className="rt-v2-home-toolbar">
            <button type="button" className="btn primary" onClick={openModal}>
              + 新建模拟面试
            </button>
          </div>
          {!records.length ? (
            <div className="rt-v2-home-empty">
              <h2>欢迎使用模拟面试助手，通过多练习多总结，一定能拿到心仪offer，祝你好运连连</h2>
              <p>配置简历与 JD 后，按题作答，支持文本与语音输入</p>
            </div>
          ) : (
            <div className="rt-v2-home-grid">
              {records.map((r, i) => {
                const timeLabel = formatInterviewTime(r.at) || r.time || "";
                return (
                <div className="rt-v2-rec-card mk-rec-card" key={r.id}>
                  <h3>{r.jobType || "未命名模拟面试"}</h3>
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
                    出现 {r.total || 0} 题 · 已答 {r.answered || 0}
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
            <strong>{reportRec.jobType || "模拟面试"} · 复盘报告</strong>
            <span />
          </div>
          {reportLoading && <div className="mk-report-analyzing">正在分析作答结果…</div>}
          {!reportLoading && report && (
            <>
              <div className="mk-report-hero">
                <div>
                  <div className="mk-report-score">
                    {report.total_score ?? "—"}
                    <small> / 100</small>
                  </div>
                  <div className="mk-report-sub">综合评分</div>
                </div>
                <div className="mk-report-summary">
                  <div className="mk-report-summary-title">{report.recommendation || "分析结论"}</div>
                  <p>{report.summary || "本场复盘已生成。"}</p>
                </div>
              </div>
              {(report.dimensions || []).length > 0 && (
                <div className="mk-report-dims">
                  {report.dimensions.map((d) => (
                    <div className="mk-report-dim" key={d.name || d.label}>
                      <div className="n">{d.score}</div>
                      <div className="l">{d.name || d.label}</div>
                    </div>
                  ))}
                </div>
              )}
              <h3 className="mk-report-h3">逐题反馈</h3>
              {(report.items || report.question_catalog || reportRec.questions || []).map((item, idx) => (
                <div className="mk-report-card" key={item.item_id || idx}>
                  <h4>
                    {idx + 1}. {item.question || item.q}
                  </h4>
                  <p className="muted">
                    你的回答：{item.answer_summary || item.answer_text || item.answer || "（未作答）"}
                  </p>
                  {item.score != null && <p className="muted">本题评分：{item.score}</p>}
                  {(item.optimization_tips || item.improvements)?.length > 0 && (
                    <div className="mk-report-tip">
                      优化建议：{(item.optimization_tips || item.improvements).join("；")}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {!reportLoading && !report && (
            <div className="card">
              <p className="muted">暂无服务端报告，展示本场作答摘要。</p>
              {(reportRec.questions || []).map((q, idx) => (
                <div className="mk-report-card" key={idx}>
                  <h4>
                    {idx + 1}. {q.q}
                  </h4>
                  <p className="muted">你的回答：{q.answer || "（未作答）"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "active" && (
        <div className="rt-v2-interview">
          <div className="rt-v2-iv-top">
            <div className="left">
              <span className="rt-v2-dot" />
              <strong>模拟面试进行中</strong>
              <span className="rt-v2-chip">{formatElapsed(elapsedMs)}</span>
              <span className="rt-v2-iv-tag">{configSnap?.jobType || "—"}</span>
              {(configSnap?.langs || []).map((x) => (
                <span className="rt-v2-iv-tag" key={x}>
                  {x}
                </span>
              ))}
              <span className="rt-v2-chip">
                当前第 {currentIdx + 1} 题 · 已答 {answeredCount}
              </span>
            </div>
            <div className="right">
              <button type="button" className="btn" onClick={() => finishAndGoHome()} disabled={busy}>
                结束面试
              </button>
            </div>
          </div>
          <div className="rt-v2-workspace" ref={workspaceRef}>
            <div className="rt-v2-left" ref={leftRef} style={{ width: "38%" }}>
              <section className="rt-v2-panel" style={{ flex: 1 }}>
                <div className="rt-v2-panel-bd" ref={qListScrollRef}>
                  <div className="mk-qlist">
                    {visibleQuestions.map(({ item, i }) => {
                      const current = i === currentIdx;
                      const viewing = i === viewingIdx;
                      let badge = null;
                      if (current) badge = <span className="mk-q-badge">当前问题</span>;
                      else if ((item.answer || "").trim()) badge = <span className="mk-q-badge done">已回答</span>;
                      else badge = <span className="mk-q-badge skip">未作答</span>;
                      return (
                        <button
                          type="button"
                          key={item.id || i}
                          className={`mk-q-item${current ? " current" : ""}${viewing && !current ? " viewing" : ""}`}
                          onClick={() => {
                            if (viewingIdx === currentIdx) {
                              setQuestions((prev) =>
                                prev.map((q, idx) => (idx === currentIdx ? { ...q, draft: answerRef.current } : q))
                              );
                            }
                            setViewingIdx(i);
                            setShowRef(false);
                            stopVoice();
                          }}
                        >
                          <div className="mk-q-hd">
                            <span className="mk-q-idx">第 {i + 1} 题</span>
                            {badge}
                          </div>
                          <div className="mk-q-text">{item.question}</div>
                          {(item.answer || item.draft || "").trim() ? (
                            <div className="mk-q-preview">
                              {(item.answer || "").trim() ? "作答：" : "草稿："}
                              {(item.answer || item.draft || "").trim()}
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            </div>
            <div className="rt-v2-split-v" title="拖拽调整宽度" onMouseDown={onSplitV} />
            <div className="rt-v2-right">
              <div className="rt-v2-warn">练习作答仅供自评参考，可结合「查看参考」对照优化</div>
              <section className="rt-v2-panel rt-v2-ans-panel">
                <div className="rt-v2-panel-bd mk-ans-layout">
                  <div className="mk-ans-main">
                    <div className="mk-ans-title">
                      {isCurrent ? "当前问题作答" : `第 ${viewingIdx + 1} 题作答回看`}
                    </div>
                    <div className={`mk-ans-body${!displayText.trim() ? " empty" : ""}`}>
                      {displayText.trim() ||
                        (isCurrent ? "尚未作答，可在下方输入或语音转写" : "本题暂无作答内容")}
                    </div>
                  </div>
                  {showRef && (
                    <div className="mk-ref-box">
                      <h4>参考回答</h4>
                      <div>{currentQ?.outlineText || "暂无参考"}</div>
                    </div>
                  )}
                </div>
              </section>
              <div
                className="rt-v2-split-h"
                title="拖拽调整高度"
                onMouseDown={(e) => {
                  const right = e.currentTarget.parentElement;
                  bindHSplit(e, composerRef.current, right, 140, 0.55);
                }}
              />
              <section className="rt-v2-panel mk-composer-panel" ref={composerRef}>
                <div className="mk-ctrl-bar">
                  <button type="button" className="btn" onClick={goPrev} disabled={viewingIdx <= 0}>
                    上一题
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={goNext}
                    disabled={busy || (viewingIdx === currentIdx && !interviewActive)}
                  >
                    下一题
                  </button>
                  <button type="button" className="btn" onClick={toggleRef} disabled={refLoading}>
                    {refLoading ? "生成中…" : showRef ? "收起参考" : "查看参考"}
                  </button>
                </div>
                <div className="rt-v2-composer">
                  <textarea
                    value={isCurrent ? currentQ?.draft || currentQ?.answer || "" : currentQ?.answer || currentQ?.draft || ""}
                    disabled={!isCurrent}
                    onChange={(e) => {
                      const v = e.target.value;
                      answerRef.current = v;
                      setQuestions((prev) => prev.map((q, i) => (i === currentIdx ? { ...q, draft: v } : q)));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitAnswer();
                      }
                    }}
                    placeholder="在此输入你的回答…（Enter 提交本题，Shift+Enter 换行）"
                  />
                  <div className="mk-composer-actions">
                    <button
                      type="button"
                      className={`btn${voiceOn ? " mk-voice-on" : ""}`}
                      onClick={toggleVoice}
                      disabled={!isCurrent}
                    >
                      {voiceOn ? "停止语音" : "语音输入"}
                    </button>
                    <button type="button" className="btn primary" onClick={submitAnswer} disabled={!isCurrent || busy}>
                      提交回答
                    </button>
                  </div>
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
              <h2>{modalStep === 1 ? "新建模拟面试" : "音视频配置"}</h2>
              <button type="button" className="rt-v2-modal-x" onClick={closeModal} aria-label="关闭">
                ×
              </button>
            </div>
            {modalStep === 1 ? (
              <div className="rt-v2-modal-bd">
                <div className="rt-v2-form-row">
                  <label>
                    面试简历<span className="rt-v2-req">*</span>
                  </label>
                  <div className="rt-v2-field-inline">
                    <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                      <option value="">选择简历</option>
                      {resumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name || r.id}
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
                {resumeReady ? (
                  <p className="ok-line" style={{ margin: "-6px 0 8px 106px", fontSize: 12 }}>
                    素材已就绪（{assetCount} 条）
                  </p>
                ) : (
                  <p className="muted" style={{ margin: "-6px 0 8px 106px", fontSize: 12 }}>
                    请上传简历或先在简历养成记准备素材
                  </p>
                )}
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
                    l3={jobL3}
                    open={jobOpen}
                    setOpen={(v) => {
                      setJobOpen(v);
                      if (v) setLangOpen(false);
                    }}
                    onChange={(nextL1, nextL2, nextL3) => {
                      setJobL1(nextL1);
                      setJobL2(nextL2);
                      setJobL3(nextL3);
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
                如何使用模拟面试?
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
                  disabled={busy}
                  onClick={() => {
                    if (modalStep === 1) {
                      if (!validateConfig()) return;
                      setModalStep(2);
                      refreshDevices();
                      return;
                    }
                    startInterview();
                  }}
                >
                  {modalStep === 1 ? "下一步" : busy ? "启动中…" : "开始面试"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
