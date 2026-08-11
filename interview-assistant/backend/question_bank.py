"""我的题库：通用 / 专属 / 定制 三类题库。

- 通用题库：按岗位自动拉取（后台生成，前端无需手动点生成）。
- 专属题库：基于用户简历与素材生成。
- 定制题库：基于用户粘贴的招聘 JD 生成。

存储：单用户 JSON，结构见 _save。
"""

import json
import time
import uuid
from dataclasses import asdict, dataclass, field

from sqlalchemy import delete, select

from config import settings
from database import SessionLocal
from models import QuestionBankMeta, QuestionRecord

BANK_GENERAL = "general"
BANK_PERSONAL = "personal"
BANK_CUSTOM = "custom"


@dataclass
class Question:
    question_id: str
    question: str
    answer: str = ""
    related_asset_ids: list = field(default_factory=list)


class QuestionBankStore:
    def __init__(self, user_id: str = "demo-user"):
        self.user_id = user_id or "demo-user"
        self.general_role: str = "后端工程师"
        self.general: list[Question] = []
        self.personal: list[Question] = []
        self.custom_jd: str = ""
        self.custom: list[Question] = []
        self._load()

    # 兼容旧代码：模拟面试 / 复盘默认读写「专属题库」
    @property
    def questions(self) -> list[Question]:
        return self.personal

    def _bank_list(self, bank: str) -> list[Question]:
        if bank == BANK_GENERAL:
            return self.general
        if bank == BANK_CUSTOM:
            return self.custom
        return self.personal

    def _load(self):
        with SessionLocal() as db:
            metas = db.scalars(
                select(QuestionBankMeta).where(QuestionBankMeta.user_id == self.user_id)
            ).all()
            rows = db.scalars(
                select(QuestionRecord)
                .where(QuestionRecord.user_id == self.user_id)
                .order_by(QuestionRecord.created_at.asc())
            ).all()
        meta = {item.key: item.value for item in metas}
        self.general_role = meta.get("general_role") or self.general_role
        self.custom_jd = meta.get("custom_jd") or ""
        self.general = [_record_to_question(row) for row in rows if row.bank == BANK_GENERAL]
        self.personal = [_record_to_question(row) for row in rows if row.bank == BANK_PERSONAL]
        self.custom = [_record_to_question(row) for row in rows if row.bank == BANK_CUSTOM]

    @staticmethod
    def _parse_items(raw: list) -> list[Question]:
        out = []
        for q in raw:
            out.append(
                Question(
                    question_id=q.get("question_id") or uuid.uuid4().hex[:8],
                    question=q.get("question", ""),
                    answer=q.get("answer", ""),
                    related_asset_ids=q.get("related_asset_ids", []) or [],
                )
            )
        return out

    def _save(self):
        now = time.time()
        with SessionLocal() as db:
            db.execute(delete(QuestionRecord).where(QuestionRecord.user_id == self.user_id))
            db.execute(delete(QuestionBankMeta).where(QuestionBankMeta.user_id == self.user_id))
            db.add(QuestionBankMeta(user_id=self.user_id, key="general_role", value=self.general_role))
            db.add(QuestionBankMeta(user_id=self.user_id, key="custom_jd", value=self.custom_jd))
            for bank, items in (
                (BANK_GENERAL, self.general),
                (BANK_PERSONAL, self.personal),
                (BANK_CUSTOM, self.custom),
            ):
                for item in items:
                    db.add(_question_to_record(item, self.user_id, bank, now))
            db.commit()

    def to_dicts(self, bank: str = BANK_PERSONAL) -> list[dict]:
        return [asdict(q) for q in self._bank_list(bank)]

    def snapshot(self) -> dict:
        return {
            "general": {
                "role": self.general_role,
                "questions": self.to_dicts(BANK_GENERAL),
                "count": len(self.general),
            },
            "personal": {
                "questions": self.to_dicts(BANK_PERSONAL),
                "count": len(self.personal),
            },
            "custom": {
                "jd_text": self.custom_jd,
                "questions": self.to_dicts(BANK_CUSTOM),
                "count": len(self.custom),
            },
        }

    def replace_bank(self, bank: str, items: list[dict], **meta):
        qs = []
        for q in items:
            qs.append(
                Question(
                    question_id=q.get("question_id") or uuid.uuid4().hex[:8],
                    question=q.get("question", ""),
                    answer=q.get("answer", ""),
                    related_asset_ids=q.get("related_asset_ids", []) or [],
                )
            )
        if bank == BANK_GENERAL:
            self.general = qs
            if "role" in meta:
                self.general_role = meta["role"]
        elif bank == BANK_CUSTOM:
            self.custom = qs
            if "jd_text" in meta:
                self.custom_jd = meta["jd_text"]
        else:
            self.personal = qs
        self._save()

    def replace_all(self, items: list[dict]):
        """兼容旧接口：写入专属题库。"""
        self.replace_bank(BANK_PERSONAL, items)

    def add(self, question: str, answer: str = "", related_asset_ids: list | None = None) -> Question:
        q = Question(
            question_id=uuid.uuid4().hex[:8],
            question=question,
            answer=answer,
            related_asset_ids=related_asset_ids or [],
        )
        self.personal.append(q)
        self._save()
        return q

    def update(self, qid: str, fields: dict, bank: str = BANK_PERSONAL) -> bool:
        for q in self._bank_list(bank):
            if q.question_id == qid:
                if "question" in fields and fields["question"] is not None:
                    q.question = fields["question"]
                if "answer" in fields and fields["answer"] is not None:
                    q.answer = fields["answer"]
                self._save()
                return True
        return False

    def delete(self, qid: str, bank: str = BANK_PERSONAL) -> bool:
        lst = self._bank_list(bank)
        before = len(lst)
        new_lst = [q for q in lst if q.question_id != qid]
        if len(new_lst) == before:
            return False
        if bank == BANK_GENERAL:
            self.general = new_lst
        elif bank == BANK_CUSTOM:
            self.custom = new_lst
        else:
            self.personal = new_lst
        self._save()
        return True


def _record_to_question(row: QuestionRecord) -> Question:
    return Question(
        question_id=row.question_id,
        question=row.question,
        answer=row.answer,
        related_asset_ids=row.related_asset_ids or [],
    )


def _question_to_record(question: Question, user_id: str, bank: str, now: float) -> QuestionRecord:
    return QuestionRecord(
        question_id=question.question_id,
        user_id=user_id,
        bank=bank,
        question=question.question,
        answer=question.answer,
        related_asset_ids=question.related_asset_ids or [],
        created_at=now,
    )


# --------------------------- 生成 ---------------------------
_SYSTEM_PERSONAL = """你是资深面试官 + 面试辅导教练。请根据候选人上传的简历/项目材料，自动生成一套专属面试题库。

要求：
1. 生成 8-10 道高质量面试题，覆盖自我介绍、项目深挖、技术能力、行为/动机、压力问题、反问等方向（不要给题目打类型标签）。
2. 每道题给出一段「参考回答」：自然的分段落长文本（2-4 段，用换行分段）。
3. 回答优先结合候选人简历中的真实项目、贡献和指标；缺失事实用「（此处需结合你的真实经历补充）」标注，不要编造。

只返回 JSON：{"questions": [{"question": "题干", "answer": "分段落回答"}]}"""

_SYSTEM_GENERAL = """你是资深面试官。请为目标岗位生成一套「通用高频面试题库」，题目应贴合该岗位常见考察点，但不要绑定某个具体候选人。

要求：
1. 生成 8-10 道题，覆盖自我介绍、岗位认知、专业/业务能力、项目或案例、行为面试、反问等。
2. 每道题给出通用参考回答框架（分段落长文本），供候选人结合自身经历改写。
3. 不要编造候选人个人事实。

只返回 JSON：{"questions": [{"question": "题干", "answer": "分段落回答"}]}"""

_SYSTEM_CUSTOM = """你是资深面试官。请根据用户提供的招聘 JD，生成一套高度贴合该岗位的面试题库。

要求：
1. 生成 8-10 道题，优先覆盖 JD 中的职责、技能、业务场景与隐性考察点。
2. 每道题给出参考回答（分段落长文本），并提示候选人结合自己的真实经历作答。
3. JD 未明确的信息用通用框架表达，不要编造个人经历。

只返回 JSON：{"questions": [{"question": "题干", "answer": "分段落回答"}]}"""


def _para(*parts):
    return "\n\n".join(parts)


def _mock_general(role: str) -> list[dict]:
    return [
        {
            "question": f"为什么想应聘{role}这个岗位？",
            "answer": _para(
                f"我关注{role}方向已经有一段时间，选择这个岗位是因为它的职责与我的积累高度匹配。",
                "我理解这个岗位通常需要（此处结合 JD 补充：核心职责），而我过往的项目经历正好覆盖了其中的关键能力。",
                "我希望在新团队里把已有经验迁移过来，同时补齐业务理解，尽快产生可衡量的价值。",
            ),
        },
        {
            "question": "请做一个 1 分钟左右的自我介绍。",
            "answer": _para(
                "面试官好，我目前有相关领域的工作/项目经验，核心优势是（此处结合你的经历补充）。",
                f"与{role}最相关的经历是（此处补充 1 个代表性项目或成果）。",
                "我希望加入贵司，是因为岗位方向与我的长期规划一致，也期待在真实业务中继续深化能力。",
            ),
        },
        {
            "question": f"你认为一名优秀的{role}应该具备哪些能力？你目前具备哪些？",
            "answer": _para(
                "我认为核心能力通常包括：专业基本功、业务理解、沟通协作、问题拆解与落地交付。",
                "结合这个岗位，我会特别关注（此处结合 JD 补充：如架构设计 / 数据分析 / 需求推进等）能力。",
                "我目前相对有把握的是（此处结合你的真实经历补充），仍在持续加强的是（此处补充短板及改进计划）。",
            ),
        },
        {
            "question": "介绍一个你最有代表性的项目，并说明你的个人贡献。",
            "answer": _para(
                "项目背景是（此处补充业务问题与目标）。",
                "我负责的部分是（此处补充你的角色、关键行动、技术或方法选择）。",
                "最终结果是（此处补充量化指标），这个项目锻炼了我（此处补充 1-2 个能力点）。",
            ),
        },
        {
            "question": "你在项目中遇到的最大挑战是什么？如何解决的？",
            "answer": _para(
                "最大的挑战是（此处补充具体困难，如性能瓶颈、跨团队协作、需求变更等）。",
                "我先用（问题定位方法）明确根因，再给出可选方案并评估利弊，最终选择（方案）推进落地。",
                "事后我也做了复盘，把经验沉淀为（流程/规范/工具），避免同类问题重复出现。",
            ),
        },
        {
            "question": "你如何处理与同事在技术方案上的分歧？",
            "answer": _para(
                "我的原则是对齐目标，而不是争输赢。出现分歧时，我会先确认我们是否在解决同一个问题。",
                "然后用数据、小范围验证或原型对比方案，把讨论从观点层面拉回事实层面。",
                "如果仍无法立即统一，我会先按风险最小的路径推进，并约定复盘节点。",
            ),
        },
        {
            "question": "你未来 1-3 年的职业规划是什么？",
            "answer": _para(
                "短期我希望在岗位上快速交付结果，把已有经验真正用起来。",
                f"中期希望在{role}方向形成更系统的深度，能独立负责更完整的模块或项目。",
                "长期希望既能保持专业深度，也能通过协作带动团队产出。",
            ),
        },
        {
            "question": "你有什么想问我们的？",
            "answer": _para(
                "我想了解团队当前最重要的业务目标，以及这个岗位入职后前三个月的核心期待。",
                "也想了解岗位的成长路径、协作方式，以及您觉得这个岗位最大的挑战是什么。",
            ),
        },
    ]


def _mock_custom(jd_text: str) -> list[dict]:
    hint = (jd_text or "").strip().replace("\n", " ")[:120] or "目标岗位"
    return [
        {
            "question": "请你结合 JD 要求，做一个简短的自我介绍。",
            "answer": _para(
                f"面试官好。JD 中我看到岗位核心关注（{hint}…），这与我的经历方向一致。",
                "我过往做过（此处结合你的真实经历补充），在（职责/技能）上有可迁移的经验。",
                "我希望在这个岗位上把已有能力快速落地，并在真实业务中继续深化。",
            ),
        },
        {
            "question": "JD 里提到的核心职责，你过去有哪些相关实践？",
            "answer": _para(
                "我会先对齐 JD 中的关键职责，再逐条映射到我曾经负责的工作内容。",
                "例如（此处结合 JD 关键词 + 你的项目补充 1-2 条具体案例）。",
                "如果某些要求我接触较少，我会说明学习路径和可快速补齐的计划。",
            ),
        },
        {
            "question": "JD 要求的一项关键技能，你是如何掌握并在项目中应用的？",
            "answer": _para(
                "这项技能我主要通过（学习/实践来源）掌握，并在（项目名）中应用。",
                "当时的问题是（背景），我采用（方法）完成（结果）。",
                "这段经历让我对该技能在真实业务中的边界和最佳实践有了更清晰的认识。",
            ),
        },
        {
            "question": "如果入职后让你负责 JD 中的某个模块，你会如何开展前两周工作？",
            "answer": _para(
                "前两周我会优先熟悉业务背景、现有系统/流程、团队分工和当前痛点。",
                "同时与直属同事对齐目标与优先级，列出短期可交付清单。",
                "在信息足够后，我会给出一个小范围可验证的方案或改进点，先产生可见价值。",
            ),
        },
        {
            "question": "JD 中提到的（业务场景）问题，你会如何分析和推进？",
            "answer": _para(
                "我会先明确问题指标与成功标准，再拆解为可执行的子任务。",
                "分析过程中关注数据、用户/业务反馈与现有约束，避免过早下结论。",
                "推进时保持高频同步，确保方案可落地、可验证、可复盘。",
            ),
        },
        {
            "question": "你的经历与 JD 要求之间，有哪些匹配点与差距？",
            "answer": _para(
                "匹配点主要在（此处结合 JD + 你的经历列 2-3 条）。",
                "差距可能在（此处诚实补充），我已经通过（学习/项目/课程）在补齐。",
                "我相信这些差距可以在入职后通过业务实践快速缩小。",
            ),
        },
        {
            "question": "你为什么对这条 JD 对应的岗位感兴趣？",
            "answer": _para(
                "首先是业务方向与我的兴趣、积累一致；其次是岗位职责与我的能力结构匹配。",
                f"JD 中（{hint[:40]}…）等要求，正是我希望继续深化的方向。",
                "我也希望在一个能发挥长期价值的团队里持续成长。",
            ),
        },
        {
            "question": "你还有什么关于这个岗位或团队的问题想问我？",
            "answer": _para(
                "我想进一步了解该岗位在团队中的定位、当前阶段的核心 KPI，以及跨团队协作方式。",
                "也想知道您最希望候选人在入职初期解决的一个问题是什么。",
            ),
        },
    ]


def _mock_generate(assets: list, resume_text: str) -> list[dict]:
    proj = assets[0].title if assets else "你的核心项目"
    snippet = (resume_text or "").strip().replace("\n", " ")[:60]
    base = "（参考思路，请结合你的真实经历补充具体细节）"
    templates = [
        (
            "请做一个简短的自我介绍。",
            _para(
                f"面试官好，我的背景可以概括为：{snippet or '（此处补充你的身份、年限与方向）'}。",
                f"比较有代表性的经历是「{proj}」，我主要负责核心模块的设计与落地。",
                "我希望把过往积累延续到新岗位，并持续创造可衡量的业务价值。" + base,
            ),
        ),
        (
            f"请详细介绍一下「{proj}」这个项目。",
            _para(
                "项目背景是（此处结合你的真实经历补充：业务规模、痛点）。",
                "我负责方案设计与关键模块实现，分阶段推进并持续复盘。",
                "最终取得（此处补充量化结果），也让我形成了更系统的解决问题方法。",
            ),
        ),
        (
            f"「{proj}」中遇到的最大技术/业务难点是什么？",
            _para(
                "难点是（此处结合你的真实经历补充）。",
                "我先定位根因，再评估多种方案后选择最适合当前约束的路径落地。",
                "解决后效果明显（此处补充量化结果），我也沉淀了可复用的经验。",
            ),
        ),
        (
            "讲一次你和同事或上级产生分歧、最后推动落地的经历。",
            _para(
                "分歧点是（此处补充）。",
                "我用数据和验证结果对齐事实，吸收对方方案中的合理部分，最终达成一致。",
                "这次经历让我更重视目标对齐，而不是观点争论。",
            ),
        ),
        (
            "你的优势和不足分别是什么？",
            _para(
                "优势是（此处结合真实情况补充）。",
                "不足是（此处补充），我通过优先级管理和迭代交付来平衡质量与节奏。",
            ),
        ),
        (
            "如果负责的功能上线后出现线上事故，你会怎么处理？",
            _para(
                "先止损：回滚或降级，尽快恢复服务。",
                "稳定后定位根因并修复，最后复盘补监控与流程。",
            ),
        ),
        (
            "你未来 3 年的职业规划是怎样的？",
            _para(
                "短期快速融入并交付结果。",
                "中期在核心方向形成深度，能独立负责完整模块。",
                "长期保持专业深度并带动协作产出。",
            ),
        ),
        (
            "你有什么想问我的？",
            _para(
                "想了解团队当前最重要的挑战、岗位前三个月的期待，以及成长路径。",
            ),
        ),
    ]
    related = [assets[0].asset_id] if assets else []
    return [{"question": q, "answer": a, "related_asset_ids": related} for q, a in templates]


def _llm_json(system: str, user: str) -> list[dict]:
    from llm_utils import get_llm_model, LLMServiceError, openai_client, require_llm_config

    require_llm_config()
    try:
        client = openai_client()
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.5,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        items = data.get("questions", [])
        if not items:
            raise LLMServiceError("LLM 未返回有效题库")
        return items
    except Exception as exc:
        if isinstance(exc, LLMServiceError):
            raise
        raise LLMServiceError(f"生成题库失败：{exc}") from exc


def generate_general(role: str) -> list[dict]:
    user = f"目标岗位：{role}\n请生成该岗位通用高频面试题库 JSON。"
    return _llm_json(_SYSTEM_GENERAL, user)


def generate(assets: list, resume_text: str) -> list[dict]:
    if not assets and not (resume_text or "").strip():
        raise ValueError("请先上传简历或项目材料")
    asset_brief = "\n".join(f"- [{a.asset_type}] {a.title}：{a.content}" for a in assets[:8])
    user = f"""候选人简历原文（节选）：
{(resume_text or '')[:3000]}

结构化素材：
{asset_brief or '（暂无）'}

请生成专属题库 JSON。"""
    return _llm_json(_SYSTEM_PERSONAL, user)


def generate_custom(jd_text: str) -> list[dict]:
    jd = (jd_text or "").strip()
    if not jd:
        return []
    user = f"招聘 JD：\n{jd[:6000]}\n\n请生成定制面试题库 JSON。"
    return _llm_json(_SYSTEM_CUSTOM, user)
