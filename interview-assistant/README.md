# AI 面试助手

「AI 驱动面试助手」SaaS 版。当前采用 **Web SaaS + FastAPI + PostgreSQL + Docker Compose** 架构：

- **Web（浏览器）**：账号、简历素材、题库、Web 面试工作台、项目库、面试复盘、管理员后台。
- **后端（FastAPI）**：REST + WebSocket，负责认证、素材/题库存储、实时辅助提纲、模拟面试出题、复盘报告。
- **数据库**：认证、Token、素材、题库使用 SQLAlchemy，可运行在 SQLite 或 PostgreSQL；Docker 默认 PostgreSQL。
- **部署**：Nginx 前端容器统一暴露入口，并反代 `/api` 和 `/ws` 到后端。

## 架构

```
┌─────────────────────────────────────────────┐
│  Nginx Web 容器 (React/Vite 静态资源)          │
│  · /        -> SPA                            │
│  · /api/*   -> backend:8765                   │
│  · /ws/*    -> backend:8765 WebSocket         │
└───────────────────┬─────────────────────────┘
                    │ REST / WebSocket
┌───────────────────▼─────────────────────────┐
│  Python 后端 (FastAPI)                       │
│  · 认证/租户/管理员后台                       │
│  · 简历素材/题库/项目库/复盘                   │
│  · Web 面试工作台实时辅助与模拟面试             │
└───────────────────┬─────────────────────────┘
                    │ SQLAlchemy
┌───────────────────▼─────────────────────────┐
│  PostgreSQL / SQLite                         │
└─────────────────────────────────────────────┘
```

## 目录结构

```
interview-assistant/
├── backend/                  # Python 后端 (FastAPI)
│   ├── app.py                # 入口：REST + WebSocket
│   ├── stt_aliyun.py         # 阿里云实时语音识别封装
│   ├── question_detector.py  # 问题识别
│   ├── answer_generator.py   # LLM 回答提纲生成
│   ├── interview_questions.py# 模拟面试出题
│   ├── resume_parser.py      # 简历解析（PDF/Word/txt）
│   ├── material_store.py     # 个人素材库（存储+检索）
│   ├── config.py / .env.example / requirements.txt
├── web/                      # Web 前端 (React + Vite)
│   └── src/
│       ├── pages/            # Home / Resume / QuestionBank / Interview / Projects / Review / Account
│       ├── components/       # Nav / Stub
│       └── api.js            # REST / WebSocket 客户端
├── docker-compose.yml        # Web + Backend + PostgreSQL
└── desktop/                  # 历史桌面端代码，生产 SaaS 路径不再依赖
```

## 快速开始

### 1. 后端（默认 Mock 模式，无需任何云服务 Key）

```powershell
cd interview-assistant/backend
pip install -r requirements.txt
copy .env.example .env        # 默认 MOCK_MODE=true
python app.py
```

看到 `http://127.0.0.1:8765` 即启动成功（REST + WebSocket 同端口）。

### 2. Web 前端

```powershell
cd interview-assistant/web
npm install
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。可在「简历与素材库」上传/粘贴简历，
在「面试工作台」使用实时辅助或 AI 模拟面试。

## SaaS 模式（轻量过渡版）

当前项目已从单用户 Demo 改为 SaaS 过渡架构：

- 后端提供注册、登录、当前用户接口：`/api/auth/register`、`/api/auth/login`、`/api/auth/me`
- 每个用户拥有独立的简历素材、题库、面试复盘数据
- 项目市场为全局市场，但购买、上传、收益按用户隔离
- 认证、Token、简历素材、题库已迁入 SQLAlchemy，可连接 SQLite 或 PostgreSQL
- 默认仍是 Demo 免登录模式，方便本地开发；部署时可开启强制登录

开启 SaaS 登录模式：

```powershell
cd interview-assistant/backend
copy .env.example .env
# 编辑 .env：
# REQUIRE_AUTH=true
# FIRST_ADMIN_PASSWORD=你的管理员密码
python app.py
```

Web 端进入「账号」页面注册或登录。登录成功后，浏览器和桌面端深链都会使用当前账号 Token。

管理员能力：

- `/api/admin/overview`：查看用户数、活跃 Token、项目数、订单、GMV、运行模式
- `/api/admin/users`：查看用户列表
- Web「账号」页中，管理员登录后会显示 SaaS 管理后台
- 项目审核接口现在需要管理员权限

部署建议：

- 生产环境务必设置 `REQUIRE_AUTH=true`
- 生产环境务必设置 `FIRST_ADMIN_PASSWORD`
- 默认 SQLite 适合单机小规模试运行；Docker Compose 已提供 PostgreSQL
- 复盘和项目库仍按用户/全局 JSON 存储；认证、素材和题库已进入 SQLAlchemy 数据库

### Docker 启动

```powershell
cd interview-assistant
copy backend\.env.example backend\.env
docker compose up --build
```

- Web SaaS 入口：`http://127.0.0.1:3000`
- 后端：容器内 `backend:8765`，由 Nginx 反代 `/api` 和 `/ws`
- 数据卷：`backend-data`、`postgres-data`

说明：Docker 版默认使用 PostgreSQL 承载认证与 Token；本地直接 `python app.py` 默认使用 SQLite。
素材和题库已进入 SQLAlchemy 数据库；复盘和项目库仍保留 JSON 存储，下一阶段可继续迁移。

## 验证方式（Mock 模式，全程无需云 Key）

- **Web**：简历素材页粘贴简历 → 解析出素材；首页点入口 → 进入 Web 面试工作台。
- **Web · 实时辅助**：进入后出现 Mock 输入框，输入面试官问题 → 右侧给出回答提纲，
  其中「可引用经历」会引用你在 Web 上传的简历素材（前后端共享同一素材库）。
- **Web · 模拟面试**：选择岗位、题库来源和题目数 → 创建模拟面试会话 → AI 面试官逐题出题；
  Mock 模式下可用文本回答并立即获得逐题评分，真实模式可使用浏览器麦克风转写后再编辑提交。
- **Web · 面试复盘**：Web「实时辅助」会记录问题与回答提纲；AI 模拟面试会记录真实回答、
  逐题评分、参考答案和总报告。回到「面试复盘」页可按场次回顾，并把高价值题目一键回填「专属题库」。

## 切换到真实云服务

编辑 `backend/.env`：

- `MOCK_MODE=false`
- **语音识别 STT**（把语音转文字，纯大模型如 DeepSeek 不提供该能力）：用 `STT_PROVIDER` 切换厂商：
  - 阿里云（默认）：`STT_PROVIDER=aliyun`，填 `ALIYUN_NLS_APPKEY`，再二选一：
    - 推荐填 `ALIYUN_ACCESS_KEY_ID` + `ALIYUN_ACCESS_KEY_SECRET`，程序自动换取并缓存 Token（不会 24h 过期）
    - 或直接粘贴临时 `ALIYUN_NLS_TOKEN`（24 小时失效）
    - 填完跑 `python check_aliyun.py` 自检连通性
  - 腾讯云：`STT_PROVIDER=tencent`，填 `TENCENT_APPID/SECRET_ID/SECRET_KEY`，需 `pip install tencentcloud-speech-sdk-python`
  - 本地 Whisper（离线免费）：`STT_PROVIDER=whisper`，需 `pip install faster-whisper numpy`，首次会自动下载模型
  - 换 STT 厂商同样无需改业务代码——上层只依赖统一的 `STTSession` 接口，只改 `.env` 即可
- **AI 模拟面试**：可用 `MOCK_INTERVIEW_DEFAULT_QUESTIONS` / `MOCK_INTERVIEW_MAX_QUESTIONS`
  控制默认和最大题目数；`MOCK_INTERVIEW_VOICE_ENABLED` 控制 Web 端语音按钮是否启用。
- **大模型 LLM**（回答提纲 / 题库 / 模拟出题 / 逐题评分）：走 OpenAI 兼容接口，可任选：
  - 通义千问：`LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1`，`LLM_MODEL=qwen-plus`，`DASHSCOPE_API_KEY=...`
  - DeepSeek：`LLM_BASE_URL=https://api.deepseek.com`，`LLM_MODEL=deepseek-chat`，`DEEPSEEK_API_KEY=...`

重启后端后，桌面端「开始辅助/开始回答」会捕获系统音频走真实语音识别，
回答提纲、题库与模拟面试出题由所选 LLM 生成。

> 换 LLM 厂商无需改任何业务代码——所有 LLM 调用都走统一的 OpenAI 兼容客户端，只改 `.env` 三个变量即可。

## 当前边界（后续迭代）

- 免登录，单用户共享一份素材库（固定 token）；后续接真实账号体系。
- 素材检索为关键词重叠，后续可换向量检索。
- 专属题库、AI 模拟面试、面试复盘、我的项目库均已实现：
  - 模拟面试支持岗位/JD/题库来源选择、回答持久化、逐题评分、总报告和复盘回填；
  - 复盘自动记录实时辅助识别到的问题，可一键回填题库；
  - 项目库支持按岗位浏览、未付费仅看标题/简介、模拟购买解锁、已购加入素材库、上传项目、（演示）人工审核与订单/收益分成（默认作者 80% / 平台 20%，可用 `PROJECT_PLATFORM_RATE` 调整）。
- 项目库为 Demo 级：免登录单用户、模拟支付、无真实结算/提现；后续接账号与支付通道。
- 系统音频捕获针对 Windows loopback；其它平台需单独适配。
