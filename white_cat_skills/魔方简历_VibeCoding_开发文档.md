# 魔方简历 (Magic Resume) - Vibe Coding 开发文档


---

## 1. 项目概述与目标

**产品定位**：一款现代化的在线简历编辑器，支持实时预览、自定义主题、AI 辅助编写、模块化管理，并导出为 PDF。

**核心体验**：
- 左侧：可拖拽排序的模块导航 + 表单编辑器
- 中间：富文本内容编辑区（Tiptap）
- 右侧：实时 A4 纸预览（支持缩放）
- 顶部：简历标题编辑 + 导出按钮
- 全局：主题色切换、排版设置、暗黑模式

**技术栈**（基于原项目演进，适配 Vibe Coding）：
- **框架**：Next.js 14+ (App Router)
- **语言**：TypeScript (严格模式)
- **样式**：Tailwind CSS + shadcn/ui
- **状态管理**：Zustand (持久化到 localStorage)
- **富文本**：Tiptap (Headless Editor)
- **动画**：Framer Motion
- **图标**：Lucide React
- **PDF 导出**：html2canvas + jsPDF (客户端方案，避免服务端依赖)
- **拖拽排序**：@dnd-kit/sortable

---

## 2. 项目初始化指令 (Claude Code 执行)

```bash
# 1. 创建 Next.js 项目 (使用 shadcn/ui 模板)
npx shadcn@latest init --yes --template next --base-color stone

# 2. 安装核心依赖
npm install zustand framer-motion lucide-react html2canvas jspdf @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities

# 3. 安装 Tiptap 编辑器及扩展
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-underline @tiptap/extension-list-item @tiptap/extension-bullet-list @tiptap/extension-ordered-list @tiptap/extension-placeholder

# 4. 安装 shadcn/ui 组件 (按需)
npx shadcn add button input textarea select switch slider tabs dialog dropdown-menu tooltip separator avatar badge card scroll-area popover

# 5. 安装字体 (使用系统字体栈，支持阿里巴巴普惠体作为可选)
npm install @chinese-fonts/alipuhuiti
```

---

## 3. 文件结构与目录规范

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # 根布局 (Provider 注入)
│   ├── page.tsx                  # 首页 (重定向到 /editor)
│   ├── editor/
│   │   ├── page.tsx              # 编辑器主页面 (三栏布局)
│   │   └── layout.tsx            # 编辑器布局 (固定高度，隐藏滚动条)
│   ├── globals.css               # 全局样式 + Tailwind
│   └── api/
│       └── ai/                   # AI 润色/语法检查 API Routes
│           ├── polish/route.ts
│           └── grammar/route.ts
├── components/
│   ├── ui/                       # shadcn/ui 组件 (自动生成)
│   ├── editor/                   # 编辑器相关组件
│   │   ├── EditorLayout.tsx      # 三栏布局容器
│   │   ├── LeftSidebar.tsx       # 左侧：模块导航 + 全局设置
│   │   ├── CenterPanel.tsx       # 中间：表单编辑区
│   │   ├── RightPreview.tsx      # 右侧：简历预览 (A4 纸)
│   │   ├── PreviewDock.tsx       # 预览缩放控制栏
│   │   └── ExportButton.tsx      # 导出 PDF 按钮
│   ├── modules/                  # 各模块的编辑组件
│   │   ├── BaseInfoEditor.tsx    # 基本信息编辑
│   │   ├── SkillEditor.tsx       # 专业技能编辑 (Tiptap)
│   │   ├── WorkEditor.tsx        # 工作经验编辑 (可折叠列表)
│   │   ├── ProjectEditor.tsx     # 项目经历编辑
│   │   ├── EducationEditor.tsx   # 教育经历编辑
│   │   ├── CustomEditor.tsx      # 自定义模块编辑
│   │   └── ModuleWrapper.tsx     # 模块通用包装 (拖拽手柄 + 显隐控制)
│   ├── preview/                  # 预览区组件 (纯展示，无交互)
│   │   ├── ResumePage.tsx        # A4 纸容器
│   │   ├── BaseInfoPreview.tsx
│   │   ├── SkillPreview.tsx
│   │   ├── WorkPreview.tsx
│   │   ├── ProjectPreview.tsx
│   │   ├── EducationPreview.tsx
│   │   └── CustomPreview.tsx
│   ├── shared/                   # 共享组件
│   │   ├── RichEditor.tsx        # Tiptap 富文本编辑器封装
│   │   ├── DateRangePicker.tsx   # 日期范围选择器 (带"至今"开关)
│   │   ├── ColorPicker.tsx       # 主题色选择器
│   │   ├── DraggableList.tsx     # 可拖拽排序列表
│   │   └── AiPolishButton.tsx    # AI 润色按钮
│   └── icons/                    # 自定义图标 (如果 Lucide 不满足)
├── store/                        # Zustand 状态管理
│   ├── useResumeStore.ts         # 主简历数据 Store
│   ├── useEditorStore.ts         # 编辑器 UI 状态 Store
│   └── useThemeStore.ts          # 主题/排版设置 Store
├── types/                        # TypeScript 类型定义
│   └── resume.ts                 # 核心简历数据结构
├── lib/                          # 工具函数
│   ├── utils.ts                  # 通用工具 (cn, formatDate 等)
│   ├── exportPdf.ts              # PDF 导出逻辑
│   └── constants.ts              # 常量 (默认数据、主题色选项)
├── hooks/                        # 自定义 Hooks
│   ├── useAutoSave.ts            # 自动保存到 localStorage
│   ├── useDebounce.ts            # 防抖
│   └── useMediaQuery.ts          # 响应式断点
└── data/                         # 静态数据
    └── defaultResume.ts          # 默认简历数据 (截图中的示例)
```

---

## 4. 核心数据模型 (TypeScript Schema)

**文件**: `src/types/resume.ts`

```typescript
// 模块类型枚举
export type ModuleType = 
  | 'baseInfo' 
  | 'skills' 
  | 'work' 
  | 'project' 
  | 'education' 
  | 'evaluation' 
  | 'certificate' 
  | 'custom';

// 基础字段 (支持显隐控制)
export interface Field<T = string> {
  id: string;
  label: string;
  value: T;
  visible: boolean;
  icon?: string; // Lucide 图标名
}

// 自定义字段
export interface CustomField extends Field {
  type: 'text' | 'link' | 'date';
  showLabel: boolean;
}

// 工作经历条目
export interface WorkItem {
  id: string;
  company: string;
  position: string;
  startDate: string; // YYYY/MM
  endDate: string;   // YYYY/MM 或 "至今"
  isCurrent: boolean;
  description: string; // HTML/Tiptap JSON
  visible: boolean;
}

// 项目经历条目
export interface ProjectItem {
  id: string;
  name: string;
  role: string;
  link?: { url: string; text: string };
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
  visible: boolean;
}

// 教育经历条目
export interface EducationItem {
  id: string;
  school: string;
  major: string;
  degree?: string;
  startDate: string;
  endDate: string;
  visible: boolean;
}

// 自定义模块
export interface CustomModule {
  id: string;
  title: string;
  icon: string;
  items: Array<{
    id: string;
    title: string;
    description: string;
    visible: boolean;
  }>;
}

// 主题/排版配置
export interface ThemeConfig {
  color: string;           // 主题色 hex
  fontFamily: string;        // 字体
  fontSize: number;          // 基础字号 px
  lineHeight: number;        // 行高
  moduleTitleSize: number;   // 模块标题字号
  itemTitleSize: number;     // 条目标题字号
  pagePadding: number;       // 页边距
  moduleGap: number;         // 模块间距
  paragraphGap: number;    // 段落间距
  iconMode: boolean;         // 图标模式
  subtitleCenter: boolean;   // 副标题居中
  longTitleMode: boolean;    // 长标题模式
}

// 完整简历数据
export interface ResumeData {
  id: string;
  title: string;
  updatedAt: number;
  baseInfo: {
    avatar?: string;
    name: string;
    position: string;
    status: string; // 在职/离职等
    birthday: string;
    email: string;
    phone: string;
    address: string;
    customFields: CustomField[];
    github?: { token: string; username: string };
  };
  modules: Array<{
    id: string;
    type: ModuleType;
    title: string;
    icon: string;
    visible: boolean;
    order: number;
    data: any; // WorkItem[] | ProjectItem[] | string 等
  }>;
  theme: ThemeConfig;
}
```

---

## 5. 状态管理 (Zustand Store 设计)

**文件**: `src/store/useResumeStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ResumeData, ModuleType } from '@/types/resume';
import { defaultResume } from '@/data/defaultResume';

interface ResumeStore {
  resume: ResumeData;
  activeModuleId: string | null;

  // 模块操作
  setActiveModule: (id: string) => void;
  toggleModuleVisibility: (id: string) => void;
  reorderModules: (newOrder: string[]) => void;
  addModule: (type: ModuleType, title: string) => void;
  deleteModule: (id: string) => void;

  // 数据更新 (通用)
  updateModuleData: (moduleId: string, data: any) => void;
  updateBaseInfo: (field: string, value: any) => void;
  updateTheme: (config: Partial<ThemeConfig>) => void;

  // 条目操作 (工作/项目/教育)
  addItem: (moduleId: string, item: any) => void;
  updateItem: (moduleId: string, itemId: string, data: any) => void;
  deleteItem: (moduleId: string, itemId: string) => void;
  reorderItems: (moduleId: string, newOrder: string[]) => void;
}

export const useResumeStore = create<ResumeStore>()(
  persist(
    (set, get) => ({
      resume: defaultResume,
      activeModuleId: 'baseInfo',

      setActiveModule: (id) => set({ activeModuleId: id }),

      toggleModuleVisibility: (id) => set((state) => ({
        resume: {
          ...state.resume,
          modules: state.resume.modules.map(m => 
            m.id === id ? { ...m, visible: !m.visible } : m
          )
        }
      })),

      reorderModules: (newOrder) => set((state) => ({
        resume: {
          ...state.resume,
          modules: state.resume.modules
            .map(m => ({ ...m, order: newOrder.indexOf(m.id) }))
            .sort((a, b) => a.order - b.order)
        }
      })),

      // ... 其他 actions
    }),
    {
      name: 'magic-resume-storage',
      partialize: (state) => ({ resume: state.resume }), // 只持久化 resume 数据
    }
  )
);
```

---

## 6. 关键组件实现规范

### 6.1 三栏布局 (`EditorLayout.tsx`)

```typescript
// 布局比例：左侧 280px (固定) | 中间 flex-1 | 右侧 50% (可折叠)
// 响应式：<1440px 时右侧预览折叠为浮动按钮
// 高度：100vh，禁止 body 滚动，各栏内部滚动

const EditorLayout = () => {
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f5f5f5] dark:bg-[#1a1a1a]">
      <LeftSidebar className="w-[280px] shrink-0 border-r" />
      <CenterPanel className="flex-1 min-w-[500px]" />
      {!previewCollapsed && (
        <RightPreview className="w-1/2 min-w-[600px] border-l" />
      )}
      <PreviewDock 
        collapsed={previewCollapsed}
        onToggle={() => setPreviewCollapsed(!previewCollapsed)}
      />
    </div>
  );
};
```

### 6.2 左侧模块导航 (`LeftSidebar.tsx`)

**功能要求**：
- 显示所有模块列表，带图标、显隐眼睛图标、删除垃圾桶图标
- 支持拖拽排序 (使用 @dnd-kit)
- 底部有"添加模块"按钮，点击弹出选择框 (基础模块/自定义模块)
- 下方折叠面板：主题色选择、排版设置、间距设置、模式开关

```typescript
// 模块项渲染
const ModuleListItem = ({ module, isActive }) => (
  <div 
    className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors",
      isActive ? "bg-white shadow-sm border border-gray-200" : "hover:bg-white/50"
    )}
    onClick={() => setActiveModule(module.id)}
  >
    <GripVertical className="w-4 h-4 text-gray-400 cursor-grab" />
    <Icon name={module.icon} className="w-5 h-5" />
    <span className="flex-1 text-sm font-medium">{module.title}</span>
    <Eye 
      className={cn("w-4 h-4", module.visible ? "text-gray-600" : "text-gray-300")}
      onClick={(e) => { e.stopPropagation(); toggleVisibility(module.id); }}
    />
    <Trash2 
      className="w-4 h-4 text-red-400 opacity-0 group-hover:opacity-100"
      onClick={(e) => { e.stopPropagation(); deleteModule(module.id); }}
    />
  </div>
);
```

### 6.3 富文本编辑器 (`RichEditor.tsx`)

**基于 Tiptap，配置要求**：
- 工具栏：加粗、斜体、下划线、链接、无序列表、有序列表、AI 润色按钮
- 占位符：空内容时显示提示文字
- 内容格式：存储为 HTML 字符串，预览时直接渲染
- AI 润色：选中文字后点击按钮，调用 API 替换内容

```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    Underline,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: '请输入内容...' }),
  ],
  content: value,
  onUpdate: ({ editor }) => onChange(editor.getHTML()),
});

// 工具栏按钮
const ToolbarButton = ({ command, icon, active }) => (
  <Button
    variant="ghost"
    size="sm"
    className={cn("h-8 w-8 p-0", active && "bg-gray-100")}
    onClick={() => editor?.chain().focus()[command]().run()}
  >
    {icon}
  </Button>
);
```

### 6.4 右侧预览区 (`RightPreview.tsx`)

**关键实现**：
- A4 纸比例容器：`aspect-[210/297]` 或固定宽度 `210mm`
- 缩放控制：使用 CSS `transform: scale(zoom)`，基准 zoom 为 1
- 内容完全只读，通过 Zustand 订阅实时更新
- 打印/PDF 导出时，使用 html2canvas 截图该容器

```typescript
const ResumePage = () => {
  const { resume } = useResumeStore();
  const [zoom, setZoom] = useState(0.8);

  return (
    <div className="flex items-start justify-center p-8 overflow-auto h-full">
      <div 
        className="bg-white shadow-lg origin-top transition-transform"
        style={{ 
          width: '210mm', 
          minHeight: '297mm',
          transform: `scale(${zoom})`,
          padding: `${resume.theme.pagePadding}px`,
          fontFamily: resume.theme.fontFamily,
          fontSize: `${resume.theme.fontSize}px`,
          lineHeight: resume.theme.lineHeight,
        }}
      >
        {resume.modules
          .filter(m => m.visible)
          .sort((a, b) => a.order - b.order)
          .map(module => (
            <ModulePreview key={module.id} module={module} />
          ))}
      </div>
    </div>
  );
};
```

---

## 7. 默认数据与常量

**文件**: `src/data/defaultResume.ts`

根据截图内容，构建默认数据：

```typescript
export const defaultResume: ResumeData = {
  id: 'default',
  title: '新建简历 bbcb94',
  updatedAt: Date.now(),
  baseInfo: {
    avatar: '/avatar-placeholder.png',
    name: '宋哈娜',
    position: '高级前端工程师',
    status: '离职',
    birthday: '2025/01',
    email: 'zhangsan@example.com',
    phone: '13800138000',
    address: '北京市朝阳区',
    customFields: [
      { 
        id: 'cf1', 
        label: '个人网站', 
        value: 'https://zhangsan.dev', 
        visible: true, 
        type: 'link',
        showLabel: false 
      }
    ],
    github: { token: '', username: '' }
  },
  modules: [
    {
      id: 'skills',
      type: 'skills',
      title: '专业技能',
      icon: 'Zap',
      visible: true,
      order: 1,
      data: '<ul><li>前端框架：熟悉 React、Vue.js...</li>...</ul>'
    },
    {
      id: 'work',
      type: 'work',
      title: '工作经验',
      icon: 'Briefcase',
      visible: true,
      order: 2,
      data: [
        {
          id: 'w1',
          company: '字节跳动',
          position: '高级前端工程师',
          startDate: '2021/07',
          endDate: '2024/12',
          isCurrent: false,
          description: '<ul><li>负责抖音创作者平台的开发与维护...</li></ul>',
          visible: true
        }
      ]
    },
    // ... 项目经历、教育经历等
  ],
  theme: {
    color: '#000000',
    fontFamily: 'Alibaba PuHuiTi, MiSans, system-ui, sans-serif',
    fontSize: 16,
    lineHeight: 1.5,
    moduleTitleSize: 18,
    itemTitleSize: 16,
    pagePadding: 32,
    moduleGap: 16,
    paragraphGap: 12,
    iconMode: true,
    subtitleCenter: true,
    longTitleMode: false,
  }
};
```

---

## 8. PDF 导出实现

**文件**: `src/lib/exportPdf.ts`

```typescript
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export async function exportToPdf(elementId: string, filename: string) {
  const element = document.getElementById(elementId);
  if (!element) return;

  // 临时重置缩放为 1，确保清晰度
  const originalTransform = element.style.transform;
  element.style.transform = 'scale(1)';

  const canvas = await html2canvas(element, {
    scale: 2, // 高清渲染
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
  });

  element.style.transform = originalTransform;

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${filename}.pdf`);
}
```

---

## 9. AI 功能 API Routes

**文件**: `src/app/api/ai/polish/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { text, type = 'polish' } = await req.json();

  // 支持通过环境变量配置多模型 (Gemini/DeepSeek/豆包)
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL || 'gemini-flash-latest';

  // 调用对应 LLM API 进行润色
  // 返回流式响应或完整文本

  return NextResponse.json({ result: polishedText });
}
```

---

## 10. 样式规范 (Tailwind + CSS Variables)

**文件**: `src/app/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --resume-primary: #000000;
    --resume-bg: #f5f5f5;
    --resume-panel: #ffffff;
    --resume-text: #1a1a1a;
    --resume-border: #e5e5e5;
  }

  .dark {
    --resume-bg: #1a1a1a;
    --resume-panel: #2a2a2a;
    --resume-text: #f5f5f5;
    --resume-border: #3a3a3a;
  }
}

@layer utilities {
  /* A4 纸阴影 */
  .a4-shadow {
    box-shadow: 0 0 20px rgba(0,0,0,0.1);
  }

  /* 隐藏滚动条但保持滚动 */
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }
}
```

---

## 11. 开发顺序与里程碑 (Vibe Coding 节奏)

### Phase 1: 骨架搭建 (第 1 轮对话)
1. 初始化项目 + 安装依赖
2. 配置 Tailwind + shadcn/ui
3. 搭建三栏布局框架 (空壳，可切换)

### Phase 2: 数据与状态 (第 2 轮对话)
1. 定义 `types/resume.ts`
2. 实现 Zustand Store (含持久化)
3. 填充默认数据

### Phase 3: 左侧导航 (第 3 轮对话)
1. 模块列表渲染
2. 显隐切换 + 激活状态
3. 拖拽排序 (@dnd-kit)

### Phase 4: 中间编辑区 (第 4-5 轮对话)
1. 基本信息表单 (头像上传、字段映射)
2. 富文本编辑器封装 (Tiptap)
3. 工作/项目/教育经历的可折叠列表项
4. 自定义字段动态添加

### Phase 5: 右侧预览 (第 6 轮对话)
1. A4 纸容器 + 缩放控制
2. 各模块预览组件 (纯展示)
3. 实时数据绑定

### Phase 6: 主题与排版 (第 7 轮对话)
1. 主题色选择器
2. 字体/字号/间距控制
3. 模式开关 (图标/副标题居中/长标题)

### Phase 7: 导出与优化 (第 8 轮对话)
1. PDF 导出功能
2. 暗黑模式适配
3. 响应式断点 (<1440px 折叠预览)

### Phase 8: AI 集成 (第 9 轮对话)
1. API Routes 搭建
2. AI 润色按钮 + 流式响应
3. 语法检查 Drawer

---

## 12. 关键设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| **状态管理** | Zustand + persist | 比 Redux 轻量，比 Context 性能高，内置持久化 |
| **富文本** | Tiptap | Headless，完全可控 UI，支持 Markdown 导出 |
| **PDF 导出** | html2canvas + jsPDF | 纯客户端，无需 Puppeteer/Playwright 服务端依赖 |
| **拖拽排序** | @dnd-kit | 现代化，无障碍支持好，比 react-beautiful-dnd 更轻 |
| **字体** | 系统字体栈 + 阿里巴巴普惠体 | 免费商用，加载快，支持中文 |
| **预览缩放** | CSS transform scale | 性能最优，保持 DOM 可交互 (对比 iframe/srcdoc) |
| **模块系统** | 统一 Module 接口 | 支持未来无限扩展自定义模块 |

---

## 13. 给 Claude Code 的提示词模板

当使用此文档进行 Vibe Coding 时，建议对 Claude Code 说：

> "请根据《魔方简历开发文档》实现 [当前 Phase] 的功能。严格按照文件结构创建文件，使用 Zustand 进行状态管理，使用 shadcn/ui 组件，Tailwind 进行样式编写。确保 TypeScript 类型安全，所有组件使用函数式组件 + Hooks。优先实现核心交互，样式细节可以后续调整。"

---

*文档版本: 1.0 | 生成日期: 2026-07-21*
*基于 GitHub: JOYCEQL/magic-resume 及产品设计截图*
