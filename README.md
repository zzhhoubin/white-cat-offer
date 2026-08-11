# White Cat Offer

**AI 驱动面试助手** — 一站式求职工具集，覆盖简历优化、岗位匹配、模拟面试、面经雷达、实时面试辅助。

## 项目结构

```
white-cat-offer/
├── interview-assistant/         # 主应用（Web SaaS + Python 后端）
│   ├── backend/                 # FastAPI 后端
│   │   ├── jd_match/            #   岗位匹配 + 简历重构 + 报告导出
│   │   ├── mianjing_radar/      #   面经雷达（牛客/小红书抓取）
│   │   └── app.py               #   入口 RMPD
│   ├── web/                     # React + Vite 前端
│   │   └── src/pages/
│   │       ├── resumeGrower/    #   简历分析台 + 岗位匹配度分析
│   │       ├── MockInterview.jsx#   AI 模拟面试
│   │       ├── MianJing.jsx     #   面经题库
│   │       ├── RealtimeAssist.jsx#  实时面试辅助
│   │       └── Interview.jsx    #   面试工作台
│   ├── desktop/                 # Electron 桌面端（历史）
│   └── docker-compose.yml       # Nginx + FastAPI + PostgreSQL
├── InterviewRadar/              # 面经雷达独立模块
├── prototypes/                  # 产品原型（HTML 交互稿）
├── docs/superpowers/specs/      # 设计文档
├── white_cat_skills/            # 自定义 Skill 定义
├── references/                  # 参考项目与技能模板
├── vip/                         # VIP 客户专属素材
└── start.bat                    # Windows 一键启动脚本
```

## 核心功能

### 简历分析台 + 岗位匹配
- PDF/Word/文本简历上传解析
- 六维书写质量评分 + 雷达图
- 岗位 JD 匹配度分析（整体评分、维度拆分、风险筛查）
- 简历重构优化（经历优先级排序、ATS 检测、生成优化版简历）
- 求职配套物料（求职信、自我介绍、面试追问预判、薪资谈判参考）
- 分析报告导出（Markdown / JSON / PDF）

### AI 模拟面试
- 多岗位多轮次 AI 模拟面试
- 逐题评分 + 总报告
- 题目回填专属题库
- 语音 / 文本双模式

### 实时面试辅助
- 实时语音识别，AI 生成回答提纲
- 关联简历素材库，可引用真实经历
- 面试复盘、题目归档

### 面经雷达
- 牛客 / 小红书面经自动抓取
- 题目去重、标签分类、题库沉淀

### 简历书写质量评分
- 六维度评分：内容完整度、结构清晰度、量化表达、关键词密度、格式规范、语言表达
- 逐项批注 + TOP 待改进建议
- 评分报告全文查看

## 快速开始

### 环境要求
- Python 3.10+
- Node.js 18+
- PostgreSQL（可选，默认 SQLite）

### 启动后端

```powershell
cd interview-assistant/backend
pip install -r requirements.txt
copy .env.example .env          # 默认 MOCK_MODE=true，免配置
python app.py                    # http://127.0.0.1:8765
```

### 启动前端

```powershell
cd interview-assistant/web
npm install
npm run dev                      # http://127.0.0.1:5173
```

### 一键启动

```powershell
.\start.bat
```

### Docker 部署

```powershell
cd interview-assistant
copy backend\.env.example backend\.env
docker compose up --build        # http://127.0.0.1:3000
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite 5 + React Router |
| 后端 | Python FastAPI + WebSocket |
| 数据库 | SQLAlchemy (SQLite / PostgreSQL) |
| LLM | OpenAI 兼容接口（通义千问 / DeepSeek / 任意） |
| 部署 | Docker Compose (Nginx + FastAPI + PostgreSQL) |

## 配置

编辑 `interview-assistant/backend/.env`：

```env
MOCK_MODE=true                  # 免云服务 Key 的 Demo 模式
MOCK_MODE=false                 # 真实模式，需配置以下 Provider

# LLM（OpenAI 兼容接口，任选）
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-xxx

# 语音识别（可选）
STT_PROVIDER=aliyun             # 阿里云 / 腾讯云 / 本地Whisper
```

## 相关技能

本仓库包含以下可复用的 AI Skill 定义：
- `resume-builder-skill.md` — 简历生成器
- `white_cat_skills/project-description-skill.md` — 项目描述优化
- `references/` 目录下含多个面试/简历相关 Skill 模板

## License

MIT
