"""轻量级问题识别：判断一段语音转写文本是否像是面试官提出的问题。

Demo 阶段用规则启发式即可，足够快（<1ms），不引入额外延迟。
后续可替换为更准确的小模型 / LLM 分类。
"""

import re

# 常见疑问词 / 问句结尾标志
_QUESTION_MARKERS = [
    "吗", "呢", "?", "？",
    "为什么", "怎么", "如何", "为何", "是否", "能不能", "可不可以",
    "请", "讲一下", "说一下", "介绍一下", "聊聊", "谈谈", "说说",
    "你的", "你是", "你有", "你会", "你能", "你觉得", "你认为",
    "什么", "哪些", "哪个", "多少", "几", "谁", "哪里", "什么时候",
]

# 面试官常见开场 / 追问句式
_INTERVIEW_PATTERNS = [
    r"自我介绍",
    r"项目.*(难点|挑战|贡献|负责|架构|方案)",
    r"(优点|缺点|短板)",
    r"(离职|跳槽).*原因",
    r"职业(规划|发展)",
    r"期望薪资",
    r"还有.*问题",
]


def is_question(text: str) -> bool:
    """返回这段文本是否更可能是「面试问题」。"""
    if not text or len(text.strip()) < 2:
        return False

    t = text.strip()

    # 太短的语气词 / 附和不算问题
    if t in ("嗯", "哦", "对", "好", "好的", "嗯嗯", "对对"):
        return False

    for marker in _QUESTION_MARKERS:
        if marker in t:
            return True

    for pat in _INTERVIEW_PATTERNS:
        if re.search(pat, t):
            return True

    return False


def guess_question_type(text: str) -> str:
    """粗略判断问题类型，便于面板展示和检索素材。"""
    if "自我介绍" in text:
        return "自我介绍"
    if re.search(r"项目|架构|方案|技术|实现", text):
        return "项目深挖"
    if re.search(r"为什么|原因|离职|跳槽|动机", text):
        return "动机/行为"
    if re.search(r"优点|缺点|短板|压力|失败|冲突", text):
        return "行为面试"
    if re.search(r"薪资|期望|规划|发展", text):
        return "HR问题"
    if re.search(r"还有.*问题|反问", text):
        return "反问环节"
    return "通用问题"
