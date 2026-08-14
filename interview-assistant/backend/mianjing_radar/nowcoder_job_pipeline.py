# -*- coding: utf-8 -*-
"""牛客岗位面经流水线：列表 API → 详情 → 结构化抽取。

优先保证凑齐有效面经正文；在此前提下早停、少翻页、复用浏览器以压耗时。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import logging
import re
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[1]
MAP_PATH = BACKEND_DIR / "data" / "nowcoder_job_map.json"
CACHE_DIR = BACKEND_DIR / "data" / "mianjing_cache"
SEEN_DIR = BACKEND_DIR / "data" / "mianjing_seen"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

_LIST_API = "https://gw-c.nowcoder.com/api/sparta/job-experience/experience/job/list"


def _load_map() -> dict:
    return json.loads(MAP_PATH.read_text(encoding="utf-8"))


def resolve_role_config(job_l3: str, job_l2: str = "", job_l1: str = "") -> dict[str, Any]:
    raw = _load_map()
    defaults = dict(raw.get("defaults") or {})
    roles = raw.get("roles") or {}
    cfg = roles.get(job_l3)

    if cfg and cfg.get("alias_of"):
        base = dict(roles.get(cfg["alias_of"]) or {})
        base.update({k: v for k, v in cfg.items() if k != "alias_of"})
        cfg = base

    if not cfg:
        # L2 / 关键字兜底
        job_id = None
        l2_fb = raw.get("l2_fallback") or {}
        if job_l2 and job_l2 in l2_fb:
            job_id = l2_fb[job_l2]
        cfg = {
            "job_id": job_id,
            "title_include": [job_l3] if job_l3 else [],
            "title_exclude": [],
            "role_signals": [job_l3] if job_l3 else [],
        }

    if not cfg.get("job_id"):
        l2_fb = raw.get("l2_fallback") or {}
        cfg["job_id"] = l2_fb.get(job_l2) or l2_fb.get(job_l1)

    out = {**defaults, **cfg}
    out["job_l1"] = job_l1
    out["job_l2"] = job_l2
    out["job_l3"] = job_l3
    if not out.get("title_include"):
        out["title_include"] = [job_l3]
    if not out.get("role_signals"):
        out["role_signals"] = [job_l3]
    return out


def _hide_dialogs(page) -> None:
    page.evaluate(
        """() => {
        document.querySelectorAll('.login-dialog,.el-dialog__wrapper,.v-modal').forEach(e => {
          e.style.display = 'none';
        });
        document.body.style.overflow = 'auto';
    }"""
    )


def _title_match(title: str, cfg: dict) -> bool:
    t = title or ""
    excludes = cfg.get("title_exclude") or []
    includes = cfg.get("title_include") or []
    if any(x in t for x in excludes):
        return False
    if not includes:
        return True
    return any(x in t for x in includes)


def _record_to_candidate(it: dict) -> dict | None:
    cd = it.get("contentData") if isinstance(it.get("contentData"), dict) else {}
    md = it.get("momentData") if isinstance(it.get("momentData"), dict) else {}
    title = cd.get("title") or md.get("title") or ""
    cid = str(it.get("contentId") or "")
    ctype = it.get("contentType")
    if ctype == 74:
        uuid = md.get("uuid") or ""
        url = f"https://www.nowcoder.com/feed/main/detail/{uuid}" if uuid else ""
    else:
        url = f"https://www.nowcoder.com/discuss/{cid}" if cid else ""
    if not url or not title:
        return None
    created = cd.get("createdAt") or md.get("createdAt") or 0
    return {
        "title": title,
        "url": url,
        "contentId": cid,
        "contentType": ctype,
        "createdAt": created,
        "source": "api",
    }


def phase1_collect_candidates(cfg: dict, exclude_ids: set[str] | None = None) -> tuple[list[dict], dict]:
    """列表 API（常为混合流）+ 站内搜索补候选 + 种子 URL。"""
    from urllib.parse import quote

    from playwright.sync_api import sync_playwright

    t0 = time.time()
    stats = {
        "api_hits": 0,
        "api_kept": 0,
        "search_hits": 0,
        "search_kept": 0,
        "seed_hits": 0,
        "excluded_seen": 0,
        "filtered_total": 0,
        "elapsed": 0.0,
    }
    target = int(cfg.get("phase1_target_candidates") or 16)
    seen: set[str] = set()
    cands: list[dict] = []
    job_id = cfg.get("job_id")
    exclude_ids = exclude_ids or set()

    def add(c: dict, *, require_title: bool = True) -> bool:
        u = _normalize_post_id(c.get("url") or "")
        if not u or u in seen:
            return False
        if u in exclude_ids:
            stats["excluded_seen"] += 1
            return False
        title = c.get("title") or ""
        if require_title and not _title_match(title, cfg):
            # 种子：标题未知时放行，详情阶段再校验
            if c.get("source") != "seed":
                return False
            if any(x in title for x in (cfg.get("title_exclude") or [])):
                return False
        c = {**c, "url": u}
        seen.add(u)
        cands.append(c)
        return True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="zh-CN")
        page.goto(
            "https://www.nowcoder.com/interview/center",
            wait_until="domcontentloaded",
            timeout=25000,
        )
        page.wait_for_timeout(600)
        _hide_dialogs(page)

        # ---- A. 站内搜索补齐（job 列表不可靠时的主路径）----
        queries = list(cfg.get("search_queries") or [])
        job_l3 = (cfg.get("job_l3") or "").strip()
        if job_l3:
            for q in (f"{job_l3} 面经", f"{job_l3} 面试"):
                if q not in queries:
                    queries.append(q)
        if not queries and job_l3:
            queries = [f"{job_l3} 面经"]

        for q in queries:
            if len(cands) >= target:
                break
            search_url = f"https://www.nowcoder.com/search?type=post&query={quote(q)}"
            try:
                page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(2800)
                _hide_dialogs(page)
                anchors = page.eval_on_selector_all(
                    "a",
                    """els => els.map(a => ({
                        title: (a.innerText || '').trim().slice(0, 120),
                        href: a.href || ''
                      })).filter(x => x.href && (x.href.includes('/discuss/') || x.href.includes('/feed/main/detail/')))""",
                )
                stats["search_hits"] += len(anchors or [])
                for a in anchors or []:
                    href = (a.get("href") or "").split("?")[0]
                    title = (a.get("title") or "").strip()
                    if len(title) < 4:
                        continue
                    c = {
                        "title": title,
                        "url": href,
                        "contentId": href.rstrip("/").split("/")[-1],
                        "contentType": 250,
                        "createdAt": 0,
                        "source": "search",
                    }
                    if add(c):
                        stats["search_kept"] += 1
                    if len(cands) >= target:
                        break
                logger.info(
                    "mianjing phase1 search q=%s kept_total=%s",
                    q,
                    len(cands),
                )
            except Exception as e:
                logger.warning("mianjing phase1 search failed q=%s: %s", q, e)

        # ---- B. job 列表 API（可能未真正按岗过滤）----
        if job_id:
            max_pages = int(cfg.get("list_max_pages") or 3)
            page_size = int(cfg.get("list_page_size") or 20)
            order = int(cfg.get("list_order_newest") or 3)
            for page_no in range(1, max_pages + 1):
                if len(cands) >= target:
                    break
                data = page.evaluate(
                    """async ({jobId, pageNo, pageSize, order, api}) => {
                      const ctrl = new AbortController();
                      const timer = setTimeout(() => ctrl.abort(), 8000);
                      try {
                        const r = await fetch(api, {
                          method: 'POST',
                          headers: {'Content-Type': 'application/json'},
                          body: JSON.stringify({ page: pageNo, pageSize, jobId, order }),
                          signal: ctrl.signal
                        });
                        return await r.json();
                      } catch (e) {
                        return {success:false, msg:String(e)};
                      } finally {
                        clearTimeout(timer);
                      }
                    }""",
                    {
                        "jobId": job_id,
                        "pageNo": page_no,
                        "pageSize": page_size,
                        "order": order,
                        "api": cfg.get("list_api") or _LIST_API,
                    },
                )
                records = ((data or {}).get("data") or {}).get("records") or []
                stats["api_hits"] += len(records)
                if not records:
                    break
                for it in records:
                    c = _record_to_candidate(it)
                    if not c:
                        continue
                    if add(c):
                        stats["api_kept"] += 1
                logger.info(
                    "mianjing phase1 api page=%s records=%s kept_total=%s",
                    page_no,
                    len(records),
                    len(cands),
                )

        browser.close()

    # ---- C. 种子 URL（列表/搜索仍不足时兜底）----
    if len(cands) < target:
        for url in cfg.get("seed_urls") or []:
            if len(cands) >= target:
                break
            slug = url.rstrip("/").split("/")[-1]
            c = {
                "title": f"seed:{slug}",
                "url": url,
                "contentId": slug,
                "contentType": 250,
                "createdAt": 0,
                "source": "seed",
            }
            if add(c, require_title=False):
                stats["seed_hits"] += 1

    # 搜索/API 有 createdAt 的靠前；seed 靠后
    cands.sort(
        key=lambda x: (
            0 if x.get("source") == "search" else 1 if x.get("source") == "api" else 2,
            -(x.get("createdAt") or 0),
        )
    )
    stats["filtered_total"] = len(cands)
    stats["elapsed"] = round(time.time() - t0, 2)
    return cands, stats


def _extract_main_text(html: str) -> dict:
    try:
        from bs4 import BeautifulSoup
    except ImportError as e:
        raise RuntimeError("缺少 beautifulsoup4，请执行: pip install beautifulsoup4 lxml") from e
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title:
        title = soup.title.get_text(strip=True).replace("_牛客网", "")
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        title = h1.get_text(strip=True)

    main = None
    for sel in [
        ".post-topic-des",
        ".post-content",
        ".nc-post-content",
        ".feed-content",
        ".content-main",
        "article",
        ".nc-post-content-main",
    ]:
        main = soup.select_one(sel)
        if main:
            break
    if not main:
        blocks = []
        for div in soup.find_all(["div", "article", "section"]):
            t = div.get_text("\n", strip=True)
            if 200 < len(t) < 30000:
                blocks.append((len(t), t))
        blocks.sort(reverse=True)
        text = blocks[0][1] if blocks else (soup.body.get_text("\n", strip=True) if soup.body else "")
    else:
        text = main.get_text("\n", strip=True)

    m = re.search(r"(20\d{2}-\d{2}-\d{2})", soup.get_text(" ", strip=True))
    date = m.group(1) if m else ""
    return {"title": title, "text": text, "date": date}


def _looks_like_interview(text: str, title: str, cfg: dict) -> bool:
    blob = f"{title}\n{text}"
    if len(text) < 40:
        return False
    q_signals = [
        r"自我介绍",
        r"一面",
        r"二面",
        r"三面",
        r"HR面",
        r"面试问题",
        r"追问",
        r"[？?]",
        r"^\s*\d+[\.、]",
        r"问题\s*\d+",
        r"面试时长",
        r"面经",
    ]
    hits = sum(1 for p in q_signals if re.search(p, blob, re.M))
    signals = cfg.get("role_signals") or cfg.get("title_include") or []
    # 排除过宽的单字/泛词，避免「产品」单独当正文角色信号时过松
    role_keys = [k for k in signals if k and k not in {"产品"}]
    role_ok = any(k in blob for k in role_keys) if role_keys else True
    title_ok = _title_match(title, cfg) if title and not title.startswith("seed:") else role_ok
    if hits >= 2 and (role_ok or title_ok):
        return True
    return hits >= 4 and role_ok


def phase2_fetch_details(cands: list[dict], cfg: dict, exclude_ids: set[str] | None = None) -> tuple[list[dict], dict]:
    from playwright.sync_api import sync_playwright

    t0 = time.time()
    need = int(cfg.get("target_valid_posts") or 10)
    valid: list[dict] = []
    stats = {"fetched": 0, "valid": 0, "skipped": 0, "elapsed": 0.0}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(user_agent=UA, locale="zh-CN")
        exclude_ids = exclude_ids or set()
        for i, c in enumerate(cands, 1):
            if len(valid) >= need:
                break
            url = _normalize_post_id(c.get("url") or "")
            if not url or url in exclude_ids:
                stats["skipped"] += 1
                continue
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(800)
                _hide_dialogs(page)
                parsed = _extract_main_text(page.content())
                stats["fetched"] += 1
                title = parsed["title"] or c.get("title") or ""
                if not _looks_like_interview(parsed["text"], title, cfg):
                    stats["skipped"] += 1
                    continue
                item = {
                    "url": url,
                    "title": title,
                    "text": parsed["text"],
                    "date": parsed["date"],
                    "source": c.get("source"),
                }
                valid.append(item)
                stats["valid"] += 1
                logger.info("mianjing phase2 valid=%s/%s %s", stats["valid"], need, title[:40])
            except Exception as e:
                stats["skipped"] += 1
                stats.setdefault("errors", [])
                if len(stats["errors"]) < 5:
                    stats["errors"].append(f"{url} :: {type(e).__name__}: {e}")
                logger.warning("mianjing phase2 skip %s: %s", url, e)
            time.sleep(0.15)
        browser.close()

    stats["elapsed"] = round(time.time() - t0, 2)
    return valid, stats


def _normalize_company(title: str, text: str, cfg: dict) -> str:
    """从标题优先抽公司名；正文仅作弱补充，避免牛客推荐区「百度/腾讯」等污染。"""
    title = (title or "").strip()
    text = text or ""
    aliases = cfg.get("company_aliases") or {}
    # 长词优先
    keys = sorted(aliases.keys(), key=len, reverse=True)

    def alias_hit(blob: str) -> str | None:
        for k in keys:
            if k and k in blob:
                return aliases[k]
        return None

    # 常见大厂：仅出现在正文、未出现在标题时，多半是侧边推荐，不可信
    hot_brands = {
        "百度", "腾讯", "阿里", "字节", "美团", "京东", "华为", "小米",
        "快手", "拼多多", "网易", "滴滴", "oppo", "vivo", "meituan", "tencent",
    }

    # 1) 标题别名
    hit = alias_hit(title)
    if hit:
        return hit

    # 2) 标题结构：公司名常在最前，后接 Desktop/岗位/面经/轮次
    t_clean = title.replace("【", " ").replace("】", " ").replace("[", " ").replace("]", " ")
    t_clean = re.sub(r"[#|｜/／]+", " ", t_clean).strip()
    m = re.match(
        r"^([\u4e00-\u9fa5A-Za-z0-9·&\.]{2,24}?)"
        r"(?=\s|$|Desktop|面经|一面|二面|三面|HR面|实习|校招|社招|岗|面试|研发|开发|工程|产品|算法)",
        t_clean,
        flags=re.I,
    )
    if m:
        name = m.group(1).strip(" -_·,，、")
        bad_tokens = ["已offer", "秋招", "春招", "记录", "一面", "二面", "面经", "面试", "分享"]
        if name and not any(b in name for b in bad_tokens):
            job_l3 = cfg.get("job_l3") or ""
            if not (job_l3 and job_l3 in name) and "产品" not in name:
                # 标题前缀命中别名再规范化
                mapped = alias_hit(name) or name
                return mapped

    # 3) 正文：只看开头一段，且忽略「热门/推荐」噪声行
    head_lines = []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if any(x in s for x in ("相关推荐", "大家都在搜", "热议话题", "全站热榜", "猜你想搜", "邀请牛友")):
            break
        head_lines.append(s)
        if len("\n".join(head_lines)) > 400:
            break
    head = "\n".join(head_lines[:12])
    hit = alias_hit(head)
    if hit:
        # 热门大厂若标题完全未出现，判定为污染
        title_has = any(k in title for k in keys if aliases.get(k) == hit) or (hit in title)
        if hit in hot_brands and not title_has:
            pass
        else:
            return hit

    return "未明确面试公司"



def _judge_campus(title: str, text: str, cfg: dict) -> str:
    blob = f"{title}\n{text[:2500]}"
    campus = any(k in blob for k in (cfg.get("campus_keywords") or []))
    social = any(k in blob for k in (cfg.get("social_keywords") or []))
    if campus and not social:
        return "校招"
    if social and not campus:
        return "非校招"
    if campus and social:
        if re.search(r"秋招|春招|校招|应届|暑期|产培", blob):
            return "校招"
        return "非校招"
    if re.search(r"大学|研究生|本科|应届", blob):
        return "校招"
    return "非校招"


def _is_ui_noise_line(ln: str) -> bool:
    """过滤牛客页面互动/分享/评论区等非面试题噪声。"""
    s = (ln or "").replace("\ufeff", "").replace("\u200b", "").strip()
    if not s:
        return True
    exact = {
        "首页", "题库", "专项练习", "公司真题", "笔试", "面试", "在线编程",
        "面试经验", "登录", "注册", "搜索", "猜你想搜", "我要招人", "发布职位",
        "关注", "已关注", "取消关注", "点赞", "评论", "分享", "提示", "订阅专刊",
        "转发到动态", "复制链接", "微信", "QQ", "微博", "分享到微信", "分享给好友",
        "暂不保存", "保存图片", "浏览", "邀请牛友回答", "换一批", "关闭", "关 闭",
        "一键发评", "接好运", "快捷表情", "图片", "最近使用", "热门话题",
        "畅所欲言吧～", "畅所欲言吧~", "AI Agent方向",
        "忍耐王", "LangChain4j细节", "RAG全流程问得细",
    }
    if s in exact:
        return True
    if s.startswith((
        "大家都在搜", "相关推荐", "全部评论", "热议话题", "全站热榜",
        "点赞成功", "送花成功", "分享到", "分享给", "转发到",
        "聊一聊", "捎句话", "邀请牛友", "一键发评", "快捷表情",
        "畅所欲言", "最多还能上传", "共0张", "共1张", "共2张", "共3张",
        "共4张", "共5张", "共6张", "共7张", "共8张", "共9张",
        "查看更多", "展开全部", "写下你的评论", "登录后",
    )):
        return True
    if any(k in s for k in (
        "点赞成功", "送花成功", "转发到动态", "复制链接", "分享到微信",
        "分享给好友", "邀请牛友回答", "一键发评", "快捷表情",
        "最多还能上传", "畅所欲言吧", "暂不保存", "保存图片",
    )):
        return True
    if re.fullmatch(r"\d{1,7}", s):
        return True
    if re.fullmatch(r"共\d+张.*", s):
        return True
    if s.startswith("#") and len(s) < 40:
        return True
    return False


def _extract_questions(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    cleaned = []
    started = False
    for ln in lines:
        if _is_ui_noise_line(ln):
            continue
        if not started:
            if any(
                k in ln
                for k in [
                    "一面", "二面", "三面", "面试问题", "自我介绍", "面试时长",
                    "面经", "问题如下", "面试内容",
                ]
            ) or re.match(r"^\d+[\.、]", ln):
                started = True
            else:
                continue
        if ln.startswith("全部评论") or ln.startswith("热议话题") or ln.startswith("全站热榜"):
            break
        cleaned.append(ln)
        if len("\n".join(cleaned)) > 8000:
            break

    body = "\n".join(cleaned).strip()
    if len(body) < 40:
        body = "\n".join(ln for ln in lines[:160] if not _is_ui_noise_line(ln))
    body = "\n".join(ln for ln in body.splitlines() if not _is_ui_noise_line(ln)).strip()
    return body



def phase3_structure(posts: list[dict], cfg: dict) -> tuple[list[dict], dict]:
    t0 = time.time()
    items = []
    for i, p in enumerate(posts, 1):
        company = _normalize_company(p["title"], p["text"], cfg)
        campus = _judge_campus(p["title"], p["text"], cfg)
        questions = _extract_questions(p["text"])
        items.append(
            {
                "index": i,
                "company": company,
                "campus": campus,
                "questions": questions,
                "title": p["title"],
                "url": p["url"],
                "date": p.get("date") or "",
            }
        )
    return items, {"elapsed": round(time.time() - t0, 2), "rows": len(items)}


def _cache_key(job_l1: str, job_l2: str, job_l3: str) -> str:
    raw = f"{job_l1}|{job_l2}|{job_l3}".strip("|")
    safe = re.sub(r"[^\w\u4e00-\u9fa5\-]+", "_", raw)[:120]
    return safe or "unknown"



def _normalize_post_id(url: str) -> str:
    u = (url or "").strip().split("?")[0].rstrip("/")
    return u


def _read_seen(key: str) -> dict:
    path = SEEN_DIR / f"{key}.json"
    if not path.exists():
        return {"seen_ids": [], "updated_at": 0}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ids = data.get("seen_ids") or []
        return {
            "seen_ids": [str(x) for x in ids if x],
            "updated_at": float(data.get("updated_at") or 0),
            "history_batches": data.get("history_batches") or [],
        }
    except Exception:
        return {"seen_ids": [], "updated_at": 0}


def _write_seen(key: str, seen_ids: list[str], history_batches: list | None = None) -> None:
    SEEN_DIR.mkdir(parents=True, exist_ok=True)
    # 去重保序
    uniq: list[str] = []
    hit: set[str] = set()
    for x in seen_ids:
        n = _normalize_post_id(x)
        if not n or n in hit:
            continue
        hit.add(n)
        uniq.append(n)
    payload = {
        "seen_ids": uniq,
        "updated_at": time.time(),
        "history_batches": history_batches or [],
    }
    (SEEN_DIR / f"{key}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _mark_seen(key: str, urls: list[str]) -> list[str]:
    data = _read_seen(key)
    before = list(data.get("seen_ids") or [])
    batch = [_normalize_post_id(u) for u in urls if u]
    batch = [u for u in batch if u]
    merged = before + batch
    history = list(data.get("history_batches") or [])
    if batch:
        history.append({"fetched_at": time.time(), "ids": batch})
        history = history[-30:]
    _write_seen(key, merged, history)
    return batch


def _reset_seen(key: str) -> None:
    _write_seen(key, [], [])


def _read_cache(key: str, max_age_sec: int = 86400) -> dict | None:
    path = CACHE_DIR / f"{key}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ts = float(data.get("cached_at") or 0)
        if time.time() - ts > max_age_sec:
            return None
        return data
    except Exception:
        return None


def _write_cache(key: str, payload: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _fetch_experiences_inline(
    job_l3: str,
    job_l2: str = "",
    job_l1: str = "",
    limit: int = 10,
    use_cache: bool = True,
    exclude_seen: bool = False,
    reset_seen: bool = False,
) -> dict:
    """拉取岗位面经。返回 {items, timing, meta}。

    exclude_seen=True：排除该岗历史已展示面经，宁可不足 limit 篇也不复用。
    成功返回的篇目一律写入 seen（含普通获取）。
    """
    total_t0 = time.time()
    cfg = resolve_role_config(job_l3, job_l2, job_l1)
    cfg["target_valid_posts"] = max(1, min(int(limit or 10), 10))

    cache_key = _cache_key(job_l1, job_l2, job_l3)
    if reset_seen:
        _reset_seen(cache_key)

    seen_data = _read_seen(cache_key)
    seen_ids = set(seen_data.get("seen_ids") or [])
    exclude_ids: set[str] = set(seen_ids) if exclude_seen else set()

    # 重新获取（排除已看）时不走内容缓存，避免又拿到旧 10 篇
    if use_cache and not exclude_seen:
        cached = _read_cache(cache_key)
        cached_items = (cached or {}).get("items") or []
        if len(cached_items) >= cfg["target_valid_posts"]:
            items = cached_items[: cfg["target_valid_posts"]]
            # 兜底：缓存命中也记入 seen
            _mark_seen(cache_key, [it.get("url") or "" for it in items])
            return {
                "items": items,
                "timing": {
                    "total_elapsed_sec": 0.0,
                    "from_cache": True,
                    "phase1": cached.get("timing", {}).get("phase1"),
                    "phase2": cached.get("timing", {}).get("phase2"),
                    "phase3": cached.get("timing", {}).get("phase3"),
                },
                "meta": {
                    "job_l1": job_l1,
                    "job_l2": job_l2,
                    "job_l3": job_l3,
                    "job_id": cfg.get("job_id"),
                    "target": cfg["target_valid_posts"],
                    "count": len(items),
                    "incomplete": len(items) < cfg["target_valid_posts"],
                    "cached": True,
                    "exclude_seen": False,
                    "seen_total": len(seen_ids),
                },
            }

    # 排除已看时扩大候选池，提高凑满新帖概率
    if exclude_seen:
        cfg["phase1_target_candidates"] = max(
            int(cfg.get("phase1_target_candidates") or 16),
            cfg["target_valid_posts"] * 5,
            40,
        )
        cfg["list_max_pages"] = max(int(cfg.get("list_max_pages") or 3), 5)

    cands, s1 = phase1_collect_candidates(cfg, exclude_ids=exclude_ids)

    if not cands:
        exhausted = bool(exclude_seen and seen_ids)
        return {
            "items": [],
            "timing": {
                "total_elapsed_sec": round(time.time() - total_t0, 2),
                "from_cache": False,
                "phase1": s1,
            },
            "meta": {
                "job_l1": job_l1,
                "job_l2": job_l2,
                "job_l3": job_l3,
                "job_id": cfg.get("job_id"),
                "target": cfg["target_valid_posts"],
                "count": 0,
                "incomplete": True,
                "exclude_seen": exclude_seen,
                "seen_total": len(seen_ids),
                "exhausted": exhausted,
                "error": (
                    "该岗位近期可抓取的新面经已看完，可清空已看记录后重试"
                    if exhausted
                    else "未找到候选面经列表"
                ),
            },
        }

    posts, s2 = phase2_fetch_details(cands, cfg, exclude_ids=exclude_ids)
    items, s3 = phase3_structure(posts, cfg) if posts else ([], {"elapsed": 0.0, "rows": 0})

    timing = {
        "total_elapsed_sec": round(time.time() - total_t0, 2),
        "from_cache": False,
        "phase1": s1,
        "phase2": s2,
        "phase3": s3,
    }
    incomplete = len(items) < cfg["target_valid_posts"]
    note = ""
    if incomplete:
        if exclude_seen:
            note = (
                f"已排除历史看过的面经，本轮仅找到 {len(items)} 篇新面经（目标 {cfg['target_valid_posts']} 篇）"
            )
        else:
            note = f"当前仅抓取到{len(items)}篇有效面经，剩余无符合条件内容"

    result = {
        "items": items,
        "timing": timing,
        "meta": {
            "job_l1": job_l1,
            "job_l2": job_l2,
            "job_l3": job_l3,
            "job_id": cfg.get("job_id"),
            "target": cfg["target_valid_posts"],
            "count": len(items),
            "incomplete": incomplete,
            "cached": False,
            "exclude_seen": exclude_seen,
            "seen_total": len(seen_ids) + len(items),
            "exhausted": bool(exclude_seen and len(items) == 0 and seen_ids),
            "note": note,
        },
    }
    if items:
        _mark_seen(cache_key, [it.get("url") or "" for it in items])
        # 普通获取可写内容缓存；排除已看的批次不覆盖「可秒回旧文」缓存
        if not exclude_seen:
            _write_cache(
                cache_key,
                {
                    "cached_at": time.time(),
                    "items": items,
                    "timing": timing,
                    "meta": result["meta"],
                },
            )
    return result



def fetch_experiences(
    job_l3: str,
    job_l2: str = "",
    job_l1: str = "",
    limit: int = 10,
    use_cache: bool = True,
    exclude_seen: bool = False,
    reset_seen: bool = False,
) -> dict:
    """对外入口：默认子进程执行，避免 FastAPI 线程中 Playwright sync 详情全失败。"""
    if os.environ.get("MIANJING_WORKER") == "1" or os.environ.get("MIANJING_INLINE") == "1":
        return _fetch_experiences_inline(
            job_l3=job_l3,
            job_l2=job_l2,
            job_l1=job_l1,
            limit=limit,
            use_cache=use_cache,
            exclude_seen=exclude_seen,
            reset_seen=reset_seen,
        )
    return _fetch_experiences_subprocess(
        job_l3=job_l3,
        job_l2=job_l2,
        job_l1=job_l1,
        limit=limit,
        use_cache=use_cache,
        exclude_seen=exclude_seen,
        reset_seen=reset_seen,
    )


def _fetch_experiences_subprocess(
    job_l3: str,
    job_l2: str = "",
    job_l1: str = "",
    limit: int = 10,
    use_cache: bool = True,
    exclude_seen: bool = False,
    reset_seen: bool = False,
) -> dict:
    import tempfile

    payload = {
        "job_l1": job_l1,
        "job_l2": job_l2,
        "job_l3": job_l3,
        "limit": limit,
        "use_cache": use_cache,
        "exclude_seen": exclude_seen,
        "reset_seen": reset_seen,
    }
    tmp = tempfile.TemporaryDirectory(prefix="mianjing_")
    try:
        req_path = Path(tmp.name) / "request.json"
        out_path = Path(tmp.name) / "result.json"
        req_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        env = os.environ.copy()
        env["MIANJING_WORKER"] = "1"
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "mianjing_radar.nowcoder_job_pipeline",
                "--request",
                str(req_path),
                "--output",
                str(out_path),
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(BACKEND_DIR),
            env=env,
            timeout=300,
        )
        if proc.returncode != 0 or not out_path.exists():
            err = (proc.stderr or proc.stdout or "").strip()[-800:]
            logger.error("mianjing worker failed rc=%s: %s", proc.returncode, err)
            raise RuntimeError(f"面经抓取子进程失败：{err or proc.returncode}")
        return json.loads(out_path.read_text(encoding="utf-8"))
    finally:
        tmp.cleanup()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    req = json.loads(Path(args.request).read_text(encoding="utf-8"))
    out = _fetch_experiences_inline(
        job_l3=req.get("job_l3") or "",
        job_l2=req.get("job_l2") or "",
        job_l1=req.get("job_l1") or "",
        limit=int(req.get("limit") or 10),
        use_cache=bool(req.get("use_cache", True)),
        exclude_seen=bool(req.get("exclude_seen", False)),
        reset_seen=bool(req.get("reset_seen", False)),
    )
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
