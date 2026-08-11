"""SQLAlchemy models for SaaS core data.

Current migration covers identity and auth tokens. Business stores still use the
existing per-user JSON boundary and can move here incrementally.
"""

from sqlalchemy import Boolean, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class User(Base):
    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    password_salt: Mapped[str] = mapped_column(String(64), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)

    tokens: Mapped[list["AuthToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class AuthToken(Base):
    __tablename__ = "tokens"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.user_id"), index=True, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, index=True, nullable=False)

    user: Mapped[User] = relationship(back_populates="tokens")


class AssetRecord(Base):
    __tablename__ = "assets"

    asset_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    asset_type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    keywords: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    possible_followups: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.8, nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="resume", nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class UserProfile(Base):
    __tablename__ = "user_profiles"

    user_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    resume_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


class QuestionRecord(Base):
    __tablename__ = "questions"

    question_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    bank: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, default="", nullable=False)
    related_asset_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class QuestionBankMeta(Base):
    __tablename__ = "question_bank_meta"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_question_bank_meta_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)


class MockInterviewSession(Base):
    __tablename__ = "mock_interview_sessions"

    session_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(120), default="后端工程师", nullable=False)
    jd_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    company_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="zh", nullable=False)
    scope: Mapped[str] = mapped_column(String(40), default="full", nullable=False)
    source_bank: Mapped[str] = mapped_column(String(30), default="personal", nullable=False)
    question_limit: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    interview_state: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True, nullable=False)
    current_question: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    started_at: Mapped[float] = mapped_column(Float, nullable=False)
    ended_at: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    overall_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    dimensions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    report: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    answers: Mapped[list["MockInterviewAnswer"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="MockInterviewAnswer.index",
    )


class MockInterviewAnswer(Base):
    __tablename__ = "mock_interview_answers"

    answer_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("mock_interview_sessions.session_id"),
        index=True,
        nullable=False,
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    question_id: Mapped[str] = mapped_column(String(32), default="", nullable=False)
    intent: Mapped[str] = mapped_column(Text, default="", nullable=False)
    round_key: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    answer_summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    dimension_scores: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    strengths: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    improvements: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    optimization_tips: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    reference_answer: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)

    session: Mapped[MockInterviewSession] = relationship(back_populates="answers")


class MaterialDoc(Base):
    """资料库原始文档。"""

    __tablename__ = "material_docs"

    doc_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(240), nullable=False)
    mime: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    ext: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    doc_type: Mapped[str] = mapped_column(String(40), default="other", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="uploaded", index=True, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)


class MaterialCard(Base):
    """资料库归档卡片。"""

    __tablename__ = "material_cards"

    card_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    doc_id: Mapped[str] = mapped_column(String(32), default="", index=True, nullable=False)
    card_type: Mapped[str] = mapped_column(String(40), default="other", nullable=False)
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    bullets: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    evidence_quote: Mapped[str] = mapped_column(Text, default="", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.7, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


class ResumeProject(Base):
    """项目库：简历解析出的主项目。"""

    __tablename__ = "resume_projects"

    project_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    source_resume_id: Mapped[str] = mapped_column(String(64), default="", index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(240), nullable=False)
    role: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    period: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    tech_stack: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    original_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    optimized_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pitch_oral: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pitch_deep_qs: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True, nullable=False)
    adopted_at: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
    updated_at: Mapped[float] = mapped_column(Float, nullable=False)


class ProjectCardLink(Base):
    """简历项目 ↔ 资料卡（一对多）。"""

    __tablename__ = "project_card_links"
    __table_args__ = (UniqueConstraint("project_id", "card_id", name="uq_project_card"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    project_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    card_id: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    created_at: Mapped[float] = mapped_column(Float, nullable=False)
