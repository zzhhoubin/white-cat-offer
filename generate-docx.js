const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, LevelFormat, convertInchesToTwip, TabStopType, TabStopPosition,
} = require("docx");
const fs = require("fs");

const FONT = "Microsoft YaHei";
const ACCENT = "003366";
const INK = "333333";
const SUB = "666666";

function bullet(boldText, normalText) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60, line: 264 },
    children: [
      new TextRun({ text: boldText, bold: true, font: FONT, size: 20, color: INK }),
      new TextRun({ text: normalText, font: FONT, size: 20, color: INK }),
    ],
  });
}

function sectionTitle(text) {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
    children: [new TextRun({ text: "  " + text, bold: true, size: 24, color: ACCENT, font: FONT })],
  });
}

function jobHead(company, position, date) {
  return new Paragraph({
    spacing: { before: 120, after: 20 },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children: [
      new TextRun({ text: company, bold: true, size: 22, color: INK, font: FONT }),
      new TextRun({ text: "  |  ", size: 22, color: SUB, font: FONT }),
      new TextRun({ text: position, bold: true, size: 22, color: ACCENT, font: FONT }),
      new TextRun({ text: "\t" + date, size: 19, color: SUB, font: FONT }),
    ],
  });
}

function skillRow(key, val) {
  return new Paragraph({
    spacing: { after: 50, line: 252 },
    children: [
      new TextRun({ text: key + "：", bold: true, size: 20, color: INK, font: FONT }),
      new TextRun({ text: val, size: 20, color: SUB, font: FONT }),
    ],
  });
}

function eduRow(school, major, date) {
  return new Paragraph({
    spacing: { after: 50 },
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    children: [
      new TextRun({ text: school, bold: true, size: 20, color: INK, font: FONT }),
      new TextRun({ text: "　" + major, size: 20, color: SUB, font: FONT }),
      new TextRun({ text: "\t" + date, size: 19, color: SUB, font: FONT }),
    ],
  });
}

const doc = new Document({
  creator: "",
  styles: {
    default: { document: { run: { font: FONT, size: 20, color: INK } } },
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "▪", alignment: AlignmentType.LEFT,
        style: { run: { color: ACCENT }, paragraph: { indent: { left: 300, hanging: 200 } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 720, bottom: 720, left: 900, right: 900 },
      },
    },
    children: [
      // Header
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: "周　斌", bold: true, size: 44, color: ACCENT, font: FONT })],
      }),
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: "数据驱动运营负责人 / 经营分析专家", bold: true, size: 22, color: ACCENT, font: FONT })],
      }),
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: "北京  |  151****2534（微信同号）  |  zzhhoubin@126.com", size: 19, color: SUB, font: FONT })],
      }),
      new Paragraph({
        spacing: { after: 60, line: 264 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6 } },
        children: [new TextRun({
          text: "11 年数据与经营分析背景，近年转型一线运营负责人，擅长以「数据 + AI」双驱动重塑运营流程。从 0 到 1 搭建充电站运营体系，支撑全国 12000+ 充电终端，推动枪效提升 60%、日均流水达 130 万；具备从指标体系、经营分析到利润优化、用户增长的全链路落地能力。",
          size: 20, color: INK, font: FONT,
        })],
      }),

      // Skills
      sectionTitle("专业技能"),
      skillRow("数据化运营与增长", "用户成长 / VIP 会员体系、用户分层与生命周期管理、补贴与定价策略、拉新留存提升"),
      skillRow("经营分析与商业决策", "目标预算拆解、XBR 经营分析体系、关键指标异动归因、利润优化、数据看板"),
      skillRow("AI 应用与流程自动化", "AI 运营工作流搭建、Prompt Engineering、素材批量生成、智能异动分析、AI 自动打标、VibeCoding"),
      skillRow("数据分析技术栈", "SQL、Python、Tableau、机器学习、A/B 测试、埋点设计与指标体系"),
      skillRow("项目管理与协作", "跨职能项目管理（曾拉通 20+ 人研发团队）、需求收口、团队管理"),
      skillRow("认证", "高级数据分析师证书（工信部）、特许金融分析师（CFA）"),

      // Work
      sectionTitle("工作经历"),
      jobHead("城芯科技（北京）有限公司", "运营负责人（创业）", "2024.05 — 至今"),
      bullet("运营体系 0→1 构建：", "主导充电站运营全生命周期 SOP 设计与落地，覆盖场站接入、调试上线、用户运营、活动运营与服务品控，将新站平均上线周期缩短 26%，支撑全国 12000+ 充电终端的快速交付与高效运维"),
      bullet("数据驱动业绩增长：", "通过单站模型优化 + 标准化复制与区域聚焦策略，12 个月内将单枪日均充电量（枪效）提升至 176，较运营初期提升 60%，日均流水达 130 万"),
      bullet("用户增长与忠诚度体系：", "设计并落地用户成长体系、VIP 会员权益及生命周期管理模型，通过任务积分、分层权益与精准补贴，关键场站用户月均充电频次提升 15%，会员次月留存稳定在 71% 以上"),
      bullet("AI 重塑运营流程：", "搭建「AI 执行重复工作 + 人工决策」的运营工作流，沉淀 9 个高频运营 / 数据分析 Skills（活动素材制作、指标异动分析、客服投诉分类、经营分析报告生成等），将原需 2-3 人的基础工作压缩至 1 人，异动排查耗时压缩到 2 小时内"),
      bullet("数据化决策闭环：", "定义关键指标，搭建业务数据看板与异常预警机制，基于运营、用户行为及财务数据持续迭代定价、补贴与资源调度策略"),

      jobHead("能链智电", "经营分析", "2023.04 — 2024.05"),
      bullet("经营分析体系：", "搭建并迭代互联互通、SaaS 业务线 XBR 体系与数据看板，建立流水等重点指标的异动归因与预测监控模型，定期解读业务表现、定位问题并推动解决方案落地"),
      bullet("目标与绩效管理：", "负责多业务线目标预算制定与拆解，将整体经营目标分解至业务线 / 周期 / 地域 / 部门并给出可达路径建议，对接财务、战略确保经营目标上下一致"),
      bullet("拉新策略分析：", "建立场站拉新评分模型指导资源精准投放，策略落地后线下拉新 ROI 提升 8%、单客获客成本降低 3%"),
      bullet("团队管理：", "负责数据分析小组人员管理、节奏推进与交付质量把控，参与商分团队组织规划及新人成长指南计划"),

      jobHead("京东", "经营分析", "2020.10 — 2023.04"),
      bullet("指标体系 0→1：", "搭建智能家居业务指标体系，完成 APP/H5 埋点设计、数据开发与可视化，定位增长北极星指标并拆解转化漏斗，找到 KPI 提升卡点"),
      bullet("分析体系自动化：", "搭建日 / 周 / 月报分析体系，实现报表自动化可视化与异动监控，沉淀可复用分析框架"),
      bullet("标签体系与用户策略：", "0→1 设计服务转化与拉新场景用户标签并打通平台生产链路；通过数据分析 + A/B 测试优化短信拉新触达时机与文案，提升短信拉新 ROI"),

      jobHead("58 同城", "数据分析", "2017.04 — 2020.10"),
      bullet("数据产品 0→1：", "主导客服 / 销售场景数据产品 MAI 设计，拉通 20+ 人研发团队推动落地，应用于 CRM 销售作业全流程（详见项目经验）"),
      bullet("商机价值挖掘：", "通过企业客户会员消耗 / 续费 / 充值行为分析识别高价值商机特征，协同算法团队优化线索评分与排序策略，驱动销售转化效率提升与资源精准投放"),

      jobHead("美林数据", "数据分析", "2014.07 — 2017.04"),
      bullet("电网数据分析：", "参与国家电网多场景数据分析项目，负责数据清洗、建模与报告撰写，搭建经营管控 / 财务 / 人资等主题 BI 大屏与可视化看板"),

      // Projects
      sectionTitle("项目经验"),
      jobHead("销售过程智能化引擎 MAI", "58 同城", ""),
      bullet("问题与方案：", "针对销售商机重复拨打、电话接通率低等痛点，深入调研一线业务，构建覆盖销售全流程的智能营销引擎 MAI，设计商机 / 销售画像体系及商机评分、接通预测等算法模型，实现商机智能识别、排序与精准分配"),
      bullet("业务成果（A/B 测试验证）：", "实验组月均有效通话时长提升 39.1%、覆盖用户数增长 39.9%，骚扰投诉率下降 45.4%，实验组成单总额提升 8%，实现数据驱动下的销售产能释放"),

      jobHead("VIP 会员专项利润分析", "能链智电", ""),
      bullet("背景与洞察：", "VIP 会员贡献全平台 60%+ GMV 却净利率约 -7%，从用户、产品、价格、成本收入多维度开展专项分析，定位卡型单一、过度补贴为利润亏损根因"),
      bullet("策略与结果：", "推动分梯度权益卡型设计、补贴收缩与线下售卡机制落地，3 个月内会员补贴率降低 17%，助力业务线 24 年 1 月首次实现月度订单利润转正，每月减少约 70 万非必要补贴支出"),

      // Education
      sectionTitle("教育背景"),
      eduRow("长江大学", "地质统计学 · 硕士研究生", "2011.09 — 2014.07"),
      eduRow("琼州学院", "数学与应用数学 · 本科", "2007.09 — 2011.07"),
    ],
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("周斌简历2025-优化版.docx", buffer);
  console.log("DOCX generated successfully");
});
