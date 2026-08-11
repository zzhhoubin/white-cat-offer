const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  // 主进程根据深链推送要打开的功能（realtime / mock）
  onRoute: (cb) => {
    ipcRenderer.on("route", (_e, feature) => cb(feature));
  },
});
