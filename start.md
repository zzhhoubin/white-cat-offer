## 一键启动（推荐）

在项目根目录 `d:\white_cat` 双击 `start.bat`，或执行：

```powershell
.\start.ps1
```

会分别打开两个终端窗口：后端 `http://127.0.0.1:8765`、前端 `http://127.0.0.1:5173`。

后端启动时会**预加载 FunASR 模型**（控制台显示 `FunASR: 模型已预加载`），之后每次语音回答无需再等模型加载。

---

## 手动启动

1. 启动后端
cd d:\white_cat\interview-assistant\backend
# FunASR 需 Python 3.10–3.12（3.14 缺 editdistance 预编译包会安装失败）
# 建议：py -3.12 -m venv d:\white_cat\.venv
pip install -r requirements.txt
# 使用 FunASR 流式模型时额外安装
pip install funasr numpy
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
# 默认模型：paraformer-zh-streaming + ct-punc
copy .env.example .env
# 在 .env 中填写 DEEPSEEK_API_KEY；语音转写默认 funasr（本地），也可配置 aliyun/tencent/whisper
python app.py
成功后端口是：http://127.0.0.1:8765

2. 启动 Web 前端
cd d:\white_cat\interview-assistant\web
npm install
npm run dev
浏览器打开：http://127.0.0.1:5173

3. 启动桌面端
cd d:\white_cat\interview-assistant\desktop
npm install
npm start
桌面端首次启动会注册 interview-assistant:// 协议。之后你在 Web 首页点「开启实时辅助」或「开始 AI 模拟面试」就能唤起桌面端。