"use strict";

const API_BASE = "http://127.0.0.1:8765";
const WS_BASE = "ws://127.0.0.1:8765/ws/session";
const TARGET_SAMPLE_RATE = 16000;

let ws = null;
let mockMode = false;
let currentView = "home";
const audioTestState = {
  interviewer: false,
};
const rtState = {
  history: [],
  stealth: false,
  audioSource: "system",
  answerMode: "outline",
  jdText: "",
  startedAt: null,
};
const NAV_PLACEHOLDERS = {
  materials: ["▣", "素材库", "管理简历、项目材料和岗位 JD。桌面端已预留入口，当前主要在 Web 端完成上传与解析。"],
  questions: ["☷", "我的题库", "查看专属题库与参考回答。后续可在桌面端直接进入练习或同步 Web 端题库。"],
  projects: ["◇", "我的项目", "浏览已购项目、上传项目并查看收益。当前完整管理能力已在 Web 端实现。"],
  review: ["◎", "面试复盘", "按场次回顾实时辅助识别到的问题与回答提纲，并回填专属题库。"],
  help: ["?", "帮助中心", "查看音频权限、桌面端启动、真实云服务配置等使用帮助。"],
};

// 音频
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;

const $ = (id) => document.getElementById(id);

function setStatus(t) {
  $("statusbar").textContent = t;
}

// ----------------- 视图切换 -----------------
function showView(view) {
  currentView = view;
  ["home", "realtime-setup", "realtime", "realtime-summary", "mock", "placeholder"].forEach((v) => {
    const el = $(`view-${v}`);
    if (el) el.hidden = v !== view;
  });
  $("btn-home").hidden = view === "home";
  $("view-title").textContent =
    view === "realtime-setup"
      ? "实时辅助 · 配置"
      : view === "realtime"
        ? "实时面试辅助"
        : view === "realtime-summary"
          ? "会话小结"
          : view === "mock"
            ? "AI 模拟面试"
            : "OfferCat AI 面试助手";
  setActiveNav(view === "home" ? "home" : "");

  const float = $("rt-float");
  if (float) float.hidden = view !== "realtime" || rtState.stealth;

  if (view !== "realtime" && view !== "mock") {
    closeWS();
    stopCapture(false);
  }
  if (view === "realtime") {
    connectWS("realtime");
  }
  if (view === "mock") connectWS("mock");
}

function setActiveNav(key) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === key);
  });
}

function showPlaceholder(key) {
  const data = NAV_PLACEHOLDERS[key];
  if (!data) return;
  const [icon, title, desc] = data;
  $("placeholder-icon").textContent = icon;
  $("placeholder-title").textContent = title;
  $("placeholder-desc").textContent = desc;
  showView("placeholder");
  setActiveNav(key);
  $("view-title").textContent = title;
}

// ----------------- WebSocket -----------------
function connectWS(mode) {
  ws = new WebSocket(`${WS_BASE}?mode=${mode}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    $("conn-dot").classList.add("online");
    setStatus("已连接后端");
  };
  ws.onclose = () => {
    $("conn-dot").classList.remove("online");
    $("mode-badge").textContent = "未连接";
  };
  ws.onerror = () => setStatus("连接出错，请确认后端已启动 (python app.py)");
  ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
}

function closeWS() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function handleMessage(msg) {
  switch (msg.type) {
    case "ready":
      mockMode = !!msg.mock;
      $("mode-badge").textContent = mockMode ? "MOCK 模拟模式" : "REAL 真实模式";
      if ($("mk-mock-bar")) $("mk-mock-bar").hidden = !mockMode;
      break;
    case "transcript":
      if (currentView === "realtime") {
        setRtPipeline("asr");
        setRtStatus("recognizing", "识别中");
        $("rt-current-q").textContent = msg.text || "识别中…";
        $("rt-current-q").classList.remove("empty");
        $("rt-float-q").textContent = msg.text || "识别中…";
        $("rt-float-q").classList.remove("empty");
      } else if (currentView === "mock") {
        appendLog("mk-log", "我：" + msg.text, false);
      }
      break;
    case "question_detected":
      if (currentView === "realtime") {
        setRtPipeline("llm");
        setRtStatus("generating", "生成中");
        $("rt-current-q").textContent = msg.question || "";
        $("rt-current-q").classList.remove("empty");
        $("rt-float-q").textContent = msg.question || "";
      }
      break;
    case "answer":
      appendLog("rt-log", msg.question, true);
      renderOutline(msg.question, msg.outline);
      rtState.history.push({ question: msg.question, outline: msg.outline });
      setRtPipeline("done");
      setRtStatus("listening", "监听中");
      setTimeout(() => setRtPipeline("listen"), 600);
      break;
    case "info":
      setStatus(msg.text);
      if ((msg.text || "").includes("生成提纲")) {
        setRtStatus("generating", "生成中");
        setRtPipeline("llm");
      } else if ((msg.text || "").includes("监听")) {
        setRtStatus("listening", "监听中");
        setRtPipeline("listen");
      }
      break;
    case "error":
      setStatus("错误：" + msg.text);
      setRtStatus("listening", "监听中");
      setRtPipeline("listen");
      break;
  }
}

function setRtStatus(kind, text) {
  const pill = $("rt-status-pill");
  const label = $("rt-status-text");
  if (!pill || !label) return;
  pill.className = "rt-pill " + kind;
  label.textContent = text;
}

function setRtPipeline(stage) {
  const order = ["listen", "asr", "llm", "done"];
  const idx = order.indexOf(stage);
  document.querySelectorAll("#rt-pipeline span").forEach((el) => {
    const i = order.indexOf(el.dataset.p);
    el.classList.remove("on", "done");
    if (idx === 3 && i <= 3) el.classList.add("done");
    else if (i < idx) el.classList.add("done");
    else if (i === idx) el.classList.add("on");
  });
}

// ----------------- 渲染 -----------------
function appendLog(listId, text, isQuestion) {
  const li = document.createElement("li");
  li.textContent = (isQuestion ? "❓ " : "") + text;
  if (isQuestion) li.classList.add("is-question");
  $(listId).prepend(li);
}

function resolveAnswer(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  if (o.answer) return o.answer;
  const parts = [];
  if (o.example) parts.push(o.example);
  if (o.structure?.length) parts.push(o.structure.join("。") + "。");
  return parts.join("\n\n");
}

function renderOutline(question, o) {
  $("rt-answer-empty").hidden = true;
  $("rt-answer-body").hidden = false;
  const answer = resolveAnswer(o);
  const intent = o.intent || "";
  $("rt-intent").textContent = intent ? `考察：${intent}` : "";
  $("rt-intent").hidden = !intent;
  $("rt-answer-text").textContent = answer || "暂无参考答案";
  $("rt-risk").textContent = o.risk || "无";
  fillList("rt-structure", o.structure || [], "li");
  fillList("rt-keywords", o.keywords || [], "span");
  fillList("rt-refs", o.personal_refs || [], "li");
  $("rt-current-q").textContent = question;
  $("rt-current-q").classList.remove("empty");
  $("rt-float-q").textContent = question;
  $("rt-float-q").classList.remove("empty");
  let floatAns = $("rt-float-answer");
  if (!floatAns) {
    floatAns = document.createElement("p");
    floatAns.id = "rt-float-answer";
    floatAns.className = "rt-float-answer";
    $("rt-float-q").after(floatAns);
  }
  floatAns.textContent = answer;
  floatAns.hidden = !answer;
  const ol = $("rt-float-ol");
  ol.innerHTML = "";
  (o.structure || o.keywords || []).slice(0, 3).forEach((it) => {
    const li = document.createElement("li");
    li.textContent = it;
    ol.appendChild(li);
  });
}

function fillList(id, items, tag) {
  const el = $(id);
  el.innerHTML = "";
  items.forEach((it) => {
    const node = document.createElement(tag);
    node.textContent = it;
    el.appendChild(node);
  });
}

// ----------------- 系统音频捕获 -----------------
async function startCapture(opts = {}) {
  const source = opts.audioSource || rtState.audioSource;
  const forRealtime = currentView === "realtime";
  send({
    type: "start",
    answer_mode: rtState.answerMode,
    jd_text: rtState.jdText,
  });
  if (forRealtime && $("rt-stop")) $("rt-stop").disabled = false;
  if (forRealtime) {
    setRtStatus("listening", "监听中");
    setRtPipeline("listen");
  }
  try {
    if (source === "mic") {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await bindPcmStream(mediaStream);
      setStatus("正在监听麦克风…");
      return;
    }
    mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const tracks = mediaStream.getAudioTracks();
    if (tracks.length === 0) {
      setStatus("未捕获到系统音频，请勾选分享音频；仍可用文本模拟");
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      return;
    }
    mediaStream.getVideoTracks().forEach((t) => t.stop());
    await bindPcmStream(new MediaStream([tracks[0]]));
    setStatus("正在监听系统音频…");
  } catch (err) {
    setStatus("音频捕获失败：" + err.message + (forRealtime ? "（可用文本模拟）" : ""));
  }
}

async function bindPcmStream(stream) {
  mediaStream = stream;
  audioCtx = new AudioContext();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  processorNode.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const down = downsample(input, audioCtx.sampleRate, TARGET_SAMPLE_RATE);
    const pcm = floatTo16BitPCM(down);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(pcm);
  };
  sourceNode.connect(processorNode);
  processorNode.connect(audioCtx.destination);
}

function stopCapture(sendStop = true) {
  if (sendStop && ws && ws.readyState === WebSocket.OPEN) send({ type: "stop" });
  if (processorNode) processorNode.disconnect();
  if (sourceNode) sourceNode.disconnect();
  if (audioCtx) audioCtx.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  processorNode = sourceNode = audioCtx = mediaStream = null;
}

function endRealtimeSession() {
  stopCapture(true);
  closeWS();
  rtState.stealth = false;
  const float = $("rt-float");
  if (float) {
    float.hidden = true;
    float.classList.remove("hidden-stealth");
  }
  $("rt-sum-count").textContent = String(rtState.history.length);
  $("rt-sum-mode").textContent = rtState.answerMode === "outline" ? "提纲" : "话术";
  $("rt-sum-audio").textContent = rtState.audioSource === "system" ? "系统音" : "麦克风";
  $("rt-sum-meta").textContent =
    (rtState.startedAt ? new Date(rtState.startedAt).toLocaleString() : "—") +
    " · 共 " +
    rtState.history.length +
    " 题";
  const list = $("rt-sum-list");
  list.innerHTML = "";
  if (!rtState.history.length) {
    list.innerHTML = '<p class="empty">本场未识别到问题。</p>';
  } else {
    rtState.history.forEach((h, i) => {
      const div = document.createElement("div");
      div.className = "rt-sum-item";
      const pts = (h.outline?.structure || []).slice(0, 2).join("；");
      div.innerHTML = `<strong>${i + 1}. ${h.question}</strong><p>${pts || "—"}</p>`;
      list.appendChild(div);
    });
  }
  showView("realtime-summary");
}

function toggleStealth() {
  rtState.stealth = !rtState.stealth;
  const float = $("rt-float");
  if (!float) return;
  float.classList.toggle("hidden-stealth", rtState.stealth);
  setStatus(rtState.stealth ? "浮窗已隐身" : "浮窗已显示");
}

function downsample(buffer, inRate, outRate) {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let oR = 0, oB = 0;
  while (oR < newLen) {
    const next = Math.round((oR + 1) * ratio);
    let acc = 0, cnt = 0;
    for (let i = oB; i < next && i < buffer.length; i++) { acc += buffer[i]; cnt++; }
    result[oR] = cnt ? acc / cnt : 0;
    oR++; oB = next;
  }
  return result;
}

function floatTo16BitPCM(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

// ----------------- 模拟面试出题 -----------------
let mockHistory = [];
let currentQuestion = null;

async function fetchNextQuestion() {
  setStatus("AI 面试官出题中…");
  $("mk-ref-card").hidden = true;
  $("mk-ref").disabled = true;
  try {
    const res = await fetch(`${API_BASE}/api/mock-interview/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: mockHistory }),
    });
    const q = await res.json();

    if (q.done) {
      $("mk-question").textContent = "本轮题库已练完，可点「开始面试」重新开始。";
      $("mk-intent").textContent = "";
      $("mk-progress").textContent = "";
      $("mk-next").disabled = true;
      $("mk-rec-start").disabled = true;
      setStatus("题库练习完成");
      return;
    }

    currentQuestion = q;
    $("mk-question").textContent = q.question || "（暂无更多问题）";
    $("mk-intent").textContent = q.intent ? q.intent : "";
    $("mk-progress").textContent =
      q.from_bank && q.total ? `题库 ${q.index}/${q.total}` : "AI 即时出题";
    mockHistory.push({ question: q.question || "", answer: "" });

    const hasRef = !!(q.answer && q.answer.trim());
    $("mk-ref").disabled = !hasRef;
    setStatus(hasRef ? "请点「开始回答」作答；答完可看参考答案" : "请点「开始回答」用语音作答");
    $("mk-rec-start").disabled = false;
  } catch (e) {
    setStatus("出题失败，请确认后端已启动");
  }
}

function showReference() {
  if (!currentQuestion || !currentQuestion.answer) return;
  const body = $("mk-ref-body");
  body.innerHTML = "";
  currentQuestion.answer.split(/\n\s*\n/).forEach((p) => {
    if (!p.trim()) return;
    const text = document.createElement("p");
    text.textContent = p.trim();
    body.appendChild(text);
  });
  $("mk-ref-card").hidden = false;
}

// ----------------- 事件绑定 -----------------
// 首页导航与 Tab
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.nav;
    if (target === "home") {
      showView("home");
      return;
    }
    showPlaceholder(target);
    setStatus("已切换到：" + btn.textContent.trim());
  });
});

document.querySelectorAll(".home-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const key = tab.dataset.homeTab;
    document.querySelectorAll(".home-tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
    });
    $("home-tab-coach").hidden = key !== "coach";
    $("home-tab-mock").hidden = key !== "mock";
  });
});

$("home-start-realtime").addEventListener("click", () => showView("realtime-setup"));
$("home-start-mock").addEventListener("click", () => showView("mock"));
$("btn-home").addEventListener("click", () => showView("home"));
$("placeholder-home").addEventListener("click", () => showView("home"));

// 正式面试设备配置
$("setup-back").addEventListener("click", () => showView("home"));
document.querySelectorAll(".record-test").forEach((btn) => {
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "测试中…";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      audioTestState.interviewer = true;
      btn.classList.add("passed");
      btn.textContent = "已通过";
      $("setup-hint").textContent = "录音测试已通过，可以开始监听。";
    } catch (err) {
      audioTestState.interviewer = false;
      btn.disabled = false;
      btn.textContent = "录音测试";
      setStatus("录音测试失败：" + err.message);
    }
  });
});
$("setup-start").addEventListener("click", () => {
  rtState.audioSource = $("audio-source")?.value || "system";
  rtState.answerMode = $("answer-mode")?.value || "outline";
  rtState.jdText = ($("rt-jd-text")?.value || "").trim();
  rtState.history = [];
  rtState.startedAt = Date.now();
  rtState.stealth = false;
  $("rt-log").innerHTML = "";
  $("rt-answer-empty").hidden = false;
  $("rt-answer-body").hidden = true;
  $("rt-current-q").textContent = "等待面试官提问…";
  $("rt-current-q").classList.add("empty");
  $("rt-float-q").textContent = "等待面试官提问…";
  $("rt-float-q").classList.add("empty");
  $("rt-float-ol").innerHTML = "";
  showView("realtime");
  // 等 WS 连上再 start
  const tryStart = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      startCapture();
      return;
    }
    setTimeout(tryStart, 200);
  };
  tryStart();
});

// 实时辅助
$("rt-stop").addEventListener("click", endRealtimeSession);
$("rt-stealth")?.addEventListener("click", toggleStealth);
$("rt-float-min")?.addEventListener("click", toggleStealth);
$("rt-float-close")?.addEventListener("click", endRealtimeSession);
$("rt-sum-restart")?.addEventListener("click", () => showView("realtime-setup"));
$("rt-sum-home")?.addEventListener("click", () => showView("home"));
$("rt-mock-send").addEventListener("click", rtSendMock);
$("rt-mock-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") rtSendMock();
});
$("rt-copy-answer")?.addEventListener("click", () => {
  const text = $("rt-answer-text")?.textContent || "";
  if (!text) return;
  navigator.clipboard?.writeText(text).then(
    () => setStatus("已复制答案"),
    () => setStatus("复制失败")
  );
});
function rtSendMock() {
  const t = $("rt-mock-input").value.trim();
  if (!t) return;
  send({ type: "simulate", text: t });
  $("rt-mock-input").value = "";
  setRtPipeline("asr");
  setRtStatus("recognizing", "识别中");
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "\\" || e.code === "Backslash")) {
    e.preventDefault();
    if (currentView === "realtime") toggleStealth();
  }
});

// 浮窗拖拽
(function () {
  const win = $("rt-float");
  const head = $("rt-float-head");
  if (!win || !head) return;
  let dragging = false;
  let ox = 0;
  let oy = 0;
  head.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    dragging = true;
    const rect = win.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    win.style.right = "auto";
    win.style.bottom = "auto";
    win.style.left = rect.left + "px";
    win.style.top = rect.top + "px";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = Math.max(0, e.clientX - ox) + "px";
    win.style.top = Math.max(0, e.clientY - oy) + "px";
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
  });
})();

// 模拟面试
$("mk-start").addEventListener("click", () => {
  mockHistory = [];
  $("mk-log").innerHTML = "";
  $("mk-next").disabled = false;
  fetchNextQuestion();
});
$("mk-next").addEventListener("click", fetchNextQuestion);
$("mk-ref").addEventListener("click", showReference);
$("mk-rec-start").addEventListener("click", () => {
  $("mk-rec-start").disabled = true;
  $("mk-rec-stop").disabled = false;
  startCapture({ audioSource: "mic" });
});
$("mk-rec-stop").addEventListener("click", () => {
  $("mk-rec-start").disabled = false;
  $("mk-rec-stop").disabled = true;
  stopCapture(true);
});
$("mk-mock-send").addEventListener("click", mkSendMock);
$("mk-mock-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") mkSendMock();
});
function mkSendMock() {
  const t = $("mk-mock-input").value.trim();
  if (!t) return;
  send({ type: "simulate", text: t });
  if (mockHistory.length) mockHistory[mockHistory.length - 1].answer = t;
  $("mk-mock-input").value = "";
}

// 主进程深链路由
if (window.desktop && window.desktop.onRoute) {
  window.desktop.onRoute((feature) => {
    if (feature === "realtime") showView("realtime-setup");
    if (feature === "mock") showView("mock");
  });
}

showView("home");
