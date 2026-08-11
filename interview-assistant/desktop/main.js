const { app, BrowserWindow, session, desktopCapturer } = require("electron");
const path = require("path");

const PROTOCOL = "interview-assistant";
let mainWindow = null;

// 从启动参数里解析深链，返回功能名（realtime / mock）
function parseFeature(argv) {
  const urlArg = (argv || []).find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`));
  if (!urlArg) return null;
  try {
    return new URL(urlArg).hostname || null;
  } catch {
    return null;
  }
}

function routeTo(feature) {
  if (mainWindow && feature) {
    mainWindow.webContents.send("route", feature);
  }
}

// 注册自定义协议（开发期需带上脚本路径才能被系统正确回调）
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// 单实例锁：Web 再次唤起时复用已打开的窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const feature = parseFeature(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      routeTo(feature);
    }
  });

  // macOS 通过 open-url 传递协议
  app.on("open-url", (_event, url) => {
    const feature = parseFeature([url]);
    routeTo(feature);
  });

  app.whenReady().then(() => {
    setupAudioLoopback();
    createWindow(parseFeature(process.argv) || "home");
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow("home");
    });
  });
}

function setupAudioLoopback() {
  // Windows 系统音频捕获（loopback）：自动授予屏幕源 + 系统扬声器音频
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        callback({ video: sources[0], audio: "loopback" });
      });
    },
    { useSystemPicker: false }
  );
}

function createWindow(initialFeature) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 720,
    title: "AI 面试助手 · 桌面端",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    routeTo(initialFeature);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
