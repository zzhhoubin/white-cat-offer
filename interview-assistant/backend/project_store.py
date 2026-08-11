"""我的项目库（PRD 8.7 / 11.7–11.9）。

Demo 级实现（免登录、单用户、JSON 持久化、无真实支付）：
- 平台自营项目 + 用户上传项目同库。
- 未购买且非本人上传的项目：只返回标题/简介，full_content 置空并标记 locked。
- 模拟购买：生成订单并按分成比例拆分平台服务费 / 作者收益，购买后永久解锁。
- 用户上传项目默认进入「待审核」，经（演示）审核通过后才在市场展示。

单用户 Demo：买家固定为 DEMO_USER；平台项目 owner 为 "platform"，
用户自己上传的项目 owner 也是 DEMO_USER（对自己不加锁）。
"""

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field

from config import settings

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_STORE_PATH = os.path.join(_DATA_DIR, "projects.json")

# 单用户 Demo 的固定身份
DEMO_USER = "demo-user"
PLATFORM = "platform"

# 项目状态
STATUS_PENDING = "pending"      # 待审核
STATUS_PUBLISHED = "published"  # 已上架
STATUS_REJECTED = "rejected"    # 审核拒绝
STATUS_DELISTED = "delisted"    # 已下架


def _now() -> float:
    return time.time()


@dataclass
class Project:
    project_id: str
    owner_user_id: str
    owner_name: str
    title: str
    target_roles: list = field(default_factory=list)
    difficulty: str = "进阶"
    project_type: str = ""
    tags: list = field(default_factory=list)
    preview_summary: str = ""
    full_content: str = ""
    price: float = 0.0
    status: str = STATUS_PUBLISHED
    originality: str = ""  # 原创性声明
    created_at: float = field(default_factory=_now)
    published_at: float = 0.0


@dataclass
class Order:
    order_id: str
    buyer_user_id: str
    project_id: str
    owner_user_id: str
    amount: float
    platform_fee: float
    owner_income: float
    created_at: float = field(default_factory=_now)


class ProjectStore:
    def __init__(self):
        self.projects: list[Project] = []
        self.orders: list[Order] = []
        self._load()

    # ---------------- 持久化 ----------------
    def _load(self):
        if not os.path.exists(_STORE_PATH):
            self.projects = _seed_projects()
            self.orders = []
            self._save()
            return
        try:
            with open(_STORE_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.projects = [Project(**p) for p in data.get("projects", [])]
            self.orders = [Order(**o) for o in data.get("orders", [])]
        except Exception:
            self.projects = _seed_projects()
            self.orders = []

    def _save(self):
        os.makedirs(_DATA_DIR, exist_ok=True)
        with open(_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "projects": [asdict(p) for p in self.projects],
                    "orders": [asdict(o) for o in self.orders],
                },
                f,
                ensure_ascii=False,
                indent=2,
            )

    # ---------------- 查询辅助 ----------------
    def _find(self, pid: str) -> Project | None:
        for p in self.projects:
            if p.project_id == pid:
                return p
        return None

    def is_purchased(self, buyer: str, pid: str) -> bool:
        return any(o.buyer_user_id == buyer and o.project_id == pid for o in self.orders)

    def _mask(self, p: Project, buyer: str) -> dict:
        """按是否已购/是否本人，决定是否返回完整内容。"""
        unlocked = (p.owner_user_id == buyer) or self.is_purchased(buyer, p.project_id)
        d = asdict(p)
        d["locked"] = not unlocked
        d["purchased"] = self.is_purchased(buyer, p.project_id)
        d["owned"] = p.owner_user_id == buyer
        if not unlocked:
            d["full_content"] = ""
        return d

    # ---------------- 市场浏览 ----------------
    def list_market(self, buyer: str, role: str | None = None) -> list[dict]:
        out = []
        for p in self.projects:
            if p.status != STATUS_PUBLISHED:
                continue
            if role and role not in p.target_roles:
                continue
            out.append(self._mask(p, buyer))
        out.sort(key=lambda d: d["published_at"] or d["created_at"], reverse=True)
        return out

    def available_roles(self) -> list[str]:
        roles = set()
        for p in self.projects:
            if p.status == STATUS_PUBLISHED:
                roles.update(p.target_roles)
        return sorted(roles)

    def get(self, pid: str, buyer: str) -> dict | None:
        p = self._find(pid)
        if not p:
            return None
        return self._mask(p, buyer)

    # ---------------- 购买 ----------------
    def purchase(self, pid: str, buyer: str) -> dict:
        p = self._find(pid)
        if not p:
            return {"ok": False, "error": "项目不存在"}
        if p.status != STATUS_PUBLISHED:
            return {"ok": False, "error": "项目未上架"}
        if p.owner_user_id == buyer:
            return {"ok": False, "error": "不能购买自己上传的项目"}
        if self.is_purchased(buyer, pid):
            return {"ok": True, "already": True, "project": self._mask(p, buyer)}

        rate = settings.project_platform_rate
        platform_fee = round(p.price * rate, 2)
        owner_income = round(p.price - platform_fee, 2)
        order = Order(
            order_id=uuid.uuid4().hex[:8],
            buyer_user_id=buyer,
            project_id=pid,
            owner_user_id=p.owner_user_id,
            amount=p.price,
            platform_fee=platform_fee,
            owner_income=owner_income,
        )
        self.orders.append(order)
        self._save()
        return {"ok": True, "order": asdict(order), "project": self._mask(p, buyer)}

    def my_purchases(self, buyer: str) -> list[dict]:
        pids = [o.project_id for o in self.orders if o.buyer_user_id == buyer]
        return [self._mask(p, buyer) for p in self.projects if p.project_id in pids]

    # ---------------- 上传 / 我的上传 ----------------
    def create(self, owner: str, owner_name: str, fields: dict) -> Project:
        p = Project(
            project_id=uuid.uuid4().hex[:8],
            owner_user_id=owner,
            owner_name=owner_name or "我",
            title=fields.get("title", "未命名项目"),
            target_roles=fields.get("target_roles") or [],
            difficulty=fields.get("difficulty", "进阶"),
            project_type=fields.get("project_type", ""),
            tags=fields.get("tags") or [],
            preview_summary=fields.get("preview_summary", ""),
            full_content=fields.get("full_content", ""),
            price=float(fields.get("price", 0) or 0),
            status=STATUS_PENDING,
            originality=fields.get("originality", ""),
        )
        self.projects.append(p)
        self._save()
        return p

    def my_uploads(self, owner: str) -> list[dict]:
        out = []
        for p in self.projects:
            if p.owner_user_id != owner:
                continue
            d = asdict(p)
            sales = [o for o in self.orders if o.project_id == p.project_id]
            d["sales_count"] = len(sales)
            d["income_total"] = round(sum(o.owner_income for o in sales), 2)
            out.append(d)
        out.sort(key=lambda d: d["created_at"], reverse=True)
        return out

    def review(self, pid: str, action: str) -> dict:
        p = self._find(pid)
        if not p:
            return {"ok": False, "error": "项目不存在"}
        if action == "approve":
            p.status = STATUS_PUBLISHED
            p.published_at = _now()
        elif action == "reject":
            p.status = STATUS_REJECTED
        else:
            return {"ok": False, "error": "未知审核动作"}
        self._save()
        return {"ok": True, "status": p.status}

    def delist(self, pid: str, owner: str) -> bool:
        p = self._find(pid)
        if not p or p.owner_user_id != owner:
            return False
        p.status = STATUS_DELISTED
        self._save()
        return True

    # ---------------- 收益 ----------------
    def income_summary(self, owner: str) -> dict:
        orders = [o for o in self.orders if o.owner_user_id == owner]
        total = round(sum(o.owner_income for o in orders), 2)
        return {
            "owner_income_total": total,
            "order_count": len(orders),
            "platform_rate": settings.project_platform_rate,
            "orders": [asdict(o) for o in sorted(orders, key=lambda o: o.created_at, reverse=True)],
        }

    def platform_summary(self) -> dict:
        return {
            "project_count": len(self.projects),
            "published_count": len([p for p in self.projects if p.status == STATUS_PUBLISHED]),
            "pending_count": len([p for p in self.projects if p.status == STATUS_PENDING]),
            "order_count": len(self.orders),
            "gmv": round(sum(o.amount for o in self.orders), 2),
            "platform_fee_total": round(sum(o.platform_fee for o in self.orders), 2),
            "owner_income_total": round(sum(o.owner_income for o in self.orders), 2),
        }


# --------------------------- 种子数据 ---------------------------
def _seed_projects() -> list[Project]:
    now = _now()

    def mk(**kw) -> Project:
        kw.setdefault("owner_user_id", PLATFORM)
        kw.setdefault("owner_name", "平台自营")
        kw.setdefault("status", STATUS_PUBLISHED)
        kw.setdefault("published_at", now)
        return Project(project_id=uuid.uuid4().hex[:8], **kw)

    return [
        mk(
            title="高并发秒杀系统设计与落地",
            target_roles=["后端工程师", "Java工程师"],
            difficulty="高级",
            project_type="后端架构",
            tags=["高并发", "Redis", "消息队列", "限流"],
            preview_summary="从 0 设计一个支撑万级 QPS 的秒杀系统，覆盖库存扣减、防超卖、限流削峰、缓存一致性等核心难点，附面试讲法与高频追问。",
            full_content=(
                "## 项目背景\n某电商大促秒杀场景，瞬时流量是平时的 50 倍，原系统直接打挂数据库。\n\n"
                "## 你的角色与目标\n作为后端核心开发，目标是把系统稳定支撑到 1.2 万 QPS，超卖率为 0。\n\n"
                "## 关键方案\n1. 多级缓存 + Redis 预扣库存，Lua 脚本保证原子性；\n2. 消息队列异步落库削峰；\n"
                "3. 令牌桶限流 + 排队页；\n4. 库存对账兜底。\n\n"
                "## 量化结果\n峰值 1.2 万 QPS，下单 P99 80ms，超卖 0，大促零事故。\n\n"
                "## 简历写法\n「主导秒杀系统重构，通过多级缓存+Redis原子扣减+MQ削峰，支撑1.2万QPS，超卖率0」。\n\n"
                "## 高频追问\n- Redis 和 DB 库存怎么保证最终一致？\n- 为什么用 Lua 而不是分布式锁？\n- 消息丢了怎么办？"
            ),
            price=19.9,
        ),
        mk(
            title="从埋点到看板：数据指标体系搭建",
            target_roles=["数据分析师", "产品经理"],
            difficulty="进阶",
            project_type="数据分析",
            tags=["指标体系", "埋点", "AARRR", "看板"],
            preview_summary="为一款 C 端 App 从 0 搭建指标体系：埋点规范、北极星指标拆解、AARRR 漏斗与自助看板，含面试中如何讲清你的业务价值。",
            full_content=(
                "## 项目背景\n业务方决策全靠拍脑袋，缺乏统一口径的数据指标。\n\n"
                "## 你的角色\n数据分析师，牵头搭建全站指标体系。\n\n"
                "## 关键行动\n1. 统一埋点规范与命名；2. 北极星指标=次日留存×活跃时长；"
                "3. AARRR 漏斗拆解；4. 自助 BI 看板。\n\n"
                "## 量化结果\n需求响应从 3 天降到 2 小时，关键决策数据覆盖率 95%。\n\n"
                "## 面试讲法\n强调「指标拆解能力」和「数据驱动业务的实际收益」。"
            ),
            price=12.0,
        ),
        mk(
            title="React 组件库工程化与性能优化",
            target_roles=["前端工程师"],
            difficulty="进阶",
            project_type="前端工程",
            tags=["React", "组件库", "性能优化", "Monorepo"],
            preview_summary="搭建公司级 React 组件库：Monorepo 工程化、按需加载、首屏性能优化、单测与文档站，附简历量化写法。",
            full_content=(
                "## 项目背景\n各业务线 UI 重复造轮子，体验不一致。\n\n"
                "## 关键方案\nMonorepo（pnpm + turborepo）、Tree-shaking 按需加载、"
                "虚拟列表、首屏懒加载、Storybook 文档。\n\n"
                "## 量化结果\n复用率提升 60%，首屏加载从 3.2s 降到 1.1s，组件单测覆盖 85%。\n\n"
                "## 高频追问\n- 怎么做按需加载？\n- 虚拟列表原理？\n- 组件库怎么做版本管理？"
            ),
            price=15.0,
        ),
        mk(
            title="大模型 RAG 知识库问答系统",
            target_roles=["算法工程师", "AI应用工程师"],
            difficulty="高级",
            project_type="AI应用",
            tags=["LLM", "RAG", "向量检索", "Prompt"],
            preview_summary="基于 RAG 的企业知识库问答：文档切分、向量检索、重排、Prompt 工程与幻觉控制，含落地难点与面试讲法。",
            full_content=(
                "## 项目背景\n企业内部文档检索效率低，员工答疑成本高。\n\n"
                "## 关键方案\n文档切分策略、Embedding 向量库、召回+重排（rerank）、"
                "Prompt 模板、引用溯源与幻觉控制。\n\n"
                "## 量化结果\n问答准确率 88%，答疑人力成本下降 40%。\n\n"
                "## 高频追问\n- 切分粒度怎么定？\n- 召回不准怎么优化？\n- 如何评估幻觉？"
            ),
            price=25.0,
        ),
    ]
