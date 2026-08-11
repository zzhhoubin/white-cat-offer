"""项目库：简历项目 + 资料卡绑定 + 优化/话术。"""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import delete, select

from database import SessionLocal
from models import MaterialCard, ProjectCardLink, ResumeProject
from project_pack_analyzer import analyze_project_pack


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


def _format_project_text(p: dict[str, Any]) -> str:
    parts = [
        f"项目：{p.get('name') or ''}",
        f"角色：{p.get('role') or ''}",
        f"公司：{p.get('company') or ''}",
        f"时间：{' - '.join(x for x in [p.get('start'), p.get('end')] if x)}",
        f"简介：{p.get('intro') or ''}",
    ]
    for label, key in (
        ("职责", "responsibilities"),
        ("业绩", "achievements"),
        ("要点", "bullets"),
    ):
        items = p.get(key) or []
        if items:
            parts.append(label + "：")
            parts.extend(f"- {x}" for x in items if str(x).strip())
    return "\n".join(parts).strip()


def _format_optimized(rd: dict[str, Any]) -> str:
    parts = []
    if rd.get("name"):
        parts.append(f"项目：{rd['name']}")
    if rd.get("role"):
        parts.append(f"角色：{rd['role']}")
    if rd.get("intro"):
        parts.append(f"简介：{rd['intro']}")
    for label, key in (
        ("职责", "responsibilities"),
        ("业绩", "achievements"),
        ("要点", "bullets"),
    ):
        items = rd.get(key) or []
        if items:
            parts.append(label + "：")
            parts.extend(f"- {x}" for x in items if str(x).strip())
    return "\n".join(parts).strip()


def _project_dict(row: ResumeProject, card_ids: list[str] | None = None) -> dict[str, Any]:
    return {
        "project_id": row.project_id,
        "source_resume_id": row.source_resume_id,
        "name": row.name,
        "role": row.role,
        "period": row.period,
        "tech_stack": row.tech_stack or [],
        "original_text": row.original_text,
        "optimized_text": row.optimized_text,
        "pitch_oral": row.pitch_oral,
        "pitch_deep_qs": row.pitch_deep_qs or [],
        "sort_order": row.sort_order,
        "status": row.status,
        "adopted_at": row.adopted_at,
        "card_ids": card_ids if card_ids is not None else [],
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _linked_card_ids(db, user_id: str, project_id: str) -> list[str]:
    rows = db.scalars(
        select(ProjectCardLink.card_id).where(
            ProjectCardLink.user_id == user_id,
            ProjectCardLink.project_id == project_id,
        )
    ).all()
    return list(rows)


def list_projects(user_id: str, *, source_resume_id: str | None = None) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        q = select(ResumeProject).where(
            ResumeProject.user_id == user_id,
            ResumeProject.status == "active",
        )
        if source_resume_id:
            q = q.where(ResumeProject.source_resume_id == source_resume_id)
        rows = db.scalars(q.order_by(ResumeProject.sort_order.asc(), ResumeProject.created_at.desc())).all()
        return [_project_dict(r, _linked_card_ids(db, user_id, r.project_id)) for r in rows]


def sync_from_structured(
    user_id: str,
    *,
    projects: list[dict],
    source_resume_id: str = "",
    replace: bool = True,
) -> list[dict[str, Any]]:
    """从结构化简历 projects[] 同步到项目库。"""
    now = time.time()
    source_resume_id = source_resume_id or ""
    with SessionLocal() as db:
        if replace and source_resume_id:
            old = db.scalars(
                select(ResumeProject).where(
                    ResumeProject.user_id == user_id,
                    ResumeProject.source_resume_id == source_resume_id,
                )
            ).all()
            old_ids = [r.project_id for r in old]
            if old_ids:
                db.execute(
                    delete(ProjectCardLink).where(
                        ProjectCardLink.user_id == user_id,
                        ProjectCardLink.project_id.in_(old_ids),
                    )
                )
                db.execute(
                    delete(ResumeProject).where(ResumeProject.project_id.in_(old_ids))
                )
        created = []
        for i, p in enumerate(projects or []):
            if not isinstance(p, dict):
                continue
            name = str(p.get("name") or "").strip() or f"项目{i + 1}"
            period = " - ".join(
                x for x in [str(p.get("start") or "").strip(), str(p.get("end") or "").strip()] if x
            )
            tech = p.get("tech_stack") or p.get("tech") or []
            if isinstance(tech, str):
                tech = [t.strip() for t in tech.split(",") if t.strip()]
            row = ResumeProject(
                project_id=_new_id("rp_"),
                user_id=user_id,
                source_resume_id=source_resume_id,
                name=name,
                role=str(p.get("role") or "").strip(),
                period=period,
                tech_stack=[str(x) for x in tech if str(x).strip()],
                original_text=_format_project_text(p),
                optimized_text="",
                pitch_oral="",
                pitch_deep_qs=[],
                sort_order=i,
                status="active",
                adopted_at=0.0,
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            created.append(row)
        db.commit()
        for r in created:
            db.refresh(r)
        return [_project_dict(r, []) for r in created]


def bind_cards(user_id: str, project_id: str, card_ids: list[str], *, replace: bool = False) -> dict[str, Any]:
    now = time.time()
    with SessionLocal() as db:
        proj = db.get(ResumeProject, project_id)
        if not proj or proj.user_id != user_id:
            raise ValueError("项目不存在")
        valid_ids = []
        for cid in card_ids or []:
            card = db.get(MaterialCard, cid)
            if card and card.user_id == user_id:
                valid_ids.append(cid)
        if replace:
            db.execute(
                delete(ProjectCardLink).where(
                    ProjectCardLink.user_id == user_id,
                    ProjectCardLink.project_id == project_id,
                )
            )
        existing = set(
            db.scalars(
                select(ProjectCardLink.card_id).where(
                    ProjectCardLink.user_id == user_id,
                    ProjectCardLink.project_id == project_id,
                )
            ).all()
        )
        for cid in valid_ids:
            if cid in existing:
                continue
            db.add(
                ProjectCardLink(
                    user_id=user_id,
                    project_id=project_id,
                    card_id=cid,
                    created_at=now,
                )
            )
            existing.add(cid)
        proj.updated_at = now
        db.commit()
        return _project_dict(proj, list(existing))


def unbind_card(user_id: str, project_id: str, card_id: str) -> dict[str, Any]:
    with SessionLocal() as db:
        proj = db.get(ResumeProject, project_id)
        if not proj or proj.user_id != user_id:
            raise ValueError("项目不存在")
        db.execute(
            delete(ProjectCardLink).where(
                ProjectCardLink.user_id == user_id,
                ProjectCardLink.project_id == project_id,
                ProjectCardLink.card_id == card_id,
            )
        )
        proj.updated_at = time.time()
        db.commit()
        return _project_dict(proj, _linked_card_ids(db, user_id, project_id))


def optimize_project(user_id: str, project_id: str) -> dict[str, Any]:
    """结合已绑资料卡，更新 optimized_text + pitch_*。"""
    with SessionLocal() as db:
        proj = db.get(ResumeProject, project_id)
        if not proj or proj.user_id != user_id:
            raise ValueError("项目不存在")
        card_ids = _linked_card_ids(db, user_id, project_id)
        materials = []
        for cid in card_ids:
            card = db.get(MaterialCard, cid)
            if not card:
                continue
            content = "\n".join(
                [
                    card.summary or "",
                    "\n".join(f"- {b}" for b in (card.bullets or [])),
                    card.evidence_quote or "",
                ]
            ).strip()
            materials.append({"name": card.title, "content": content})
        resume_project = {
            "name": proj.name,
            "role": proj.role,
            "period": proj.period,
            "original_text": proj.original_text,
            "current_text": proj.optimized_text or proj.original_text,
        }
        name = proj.name

    analysis = analyze_project_pack(
        pack_name=name,
        resume_project=resume_project,
        materials=materials,
    )
    now = time.time()
    with SessionLocal() as db:
        proj = db.get(ResumeProject, project_id)
        if not proj or proj.user_id != user_id:
            raise ValueError("项目不存在")
        rd = analysis.get("resume_desc") or {}
        proj.optimized_text = _format_optimized(rd) or proj.optimized_text
        proj.pitch_oral = str(analysis.get("oral_script") or "").strip()
        proj.pitch_deep_qs = analysis.get("deep_questions") or []
        proj.updated_at = now
        db.commit()
        db.refresh(proj)
        return {
            "project": _project_dict(proj, _linked_card_ids(db, user_id, project_id)),
            "analysis": analysis,
        }
