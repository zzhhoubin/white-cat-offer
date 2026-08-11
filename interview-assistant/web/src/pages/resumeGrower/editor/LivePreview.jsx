import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Mail, Phone, MapPin, Globe, Calendar, Briefcase, ZoomIn, ZoomOut } from "lucide-react";
import { useResumeStore } from "./store.js";
import { resolveFontFamily } from "./FontPicker.jsx";

const PAGE_W = 794;
const PAGE_H = 1123;
const PAD_Y = 48;
const PAD_X = 56;
const CONTENT_H = PAGE_H - PAD_Y * 2;

const SECTION_TITLES = {
  basics: "基本信息",
  skills: "专业技能",
  experience: "工作经历",
  projects: "项目经历",
  education: "教育经历",
  certificates: "证书",
  languages: "语言能力",
  honors: "荣誉奖项",
  others: "其他",
};

function SectionTitle({ title, color }) {
  return (
    <div className="rg-pv-sec-title">
      <span style={{ color: color || "#2563eb" }}>{title}</span>
      <div className="rg-pv-sec-line" />
    </div>
  );
}

function HtmlContent({ html }) {
  if (!html || html === "<p></p>") return null;
  return <div className="rg-pv-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 将测量到的块高打包成页（支持 keepWithNext：标题尽量不与下一块拆开） */
function packPages(heights, keepWithNextFlags, contentH) {
  const pages = [];
  let cur = [];
  let used = 0;

  const flush = () => {
    if (cur.length) pages.push(cur);
    cur = [];
    used = 0;
  };

  for (let i = 0; i < heights.length; i += 1) {
    const h = Math.ceil(heights[i]);
    const nextH = i + 1 < heights.length ? Math.ceil(heights[i + 1]) : 0;
    const keep = keepWithNextFlags[i] && i + 1 < heights.length;

    if (h > contentH) {
      flush();
      pages.push([i]);
      continue;
    }

    const need = keep ? h + nextH : h;
    if (cur.length > 0 && used + need > contentH) {
      flush();
    } else if (cur.length > 0 && used + h > contentH) {
      flush();
    }

    cur.push(i);
    used += h;
  }
  flush();
  return pages.length ? pages : [[]];
}

function pageShellStyle(fontFamily) {
  return {
    width: `${PAGE_W}px`,
    height: `${PAGE_H}px`,
    background: "#fff",
    padding: `${PAD_Y}px ${PAD_X}px`,
    fontFamily: resolveFontFamily(fontFamily),
    color: "#1f2937",
    fontSize: "11pt",
    lineHeight: 1.7,
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

export default function LivePreview() {
  const {
    basics, skillsContent, othersContent, experience, projects, education,
    certificates, languages, honors,
    modules, customData, avatarUrl,
    themeColor, fontFamily,
  } = useResumeStore();

  const [zoom, setZoom] = useState(0.68);
  const [pageIndexLists, setPageIndexLists] = useState([[]]);
  const measureRef = useRef(null);
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 1.5;
  const ZOOM_STEP = 0.05;

  function zoomIn() { setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))); }
  function zoomOut() { setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))); }

  const modMap = useMemo(() => {
    const m = {};
    modules.forEach((mod) => { m[mod.id] = mod; });
    return m;
  }, [modules]);

  const isVisible = (id) => modMap[id]?.visible !== false;

  const blocks = useMemo(() => {
    const list = [];
    const push = (id, node, { keepWithNext = false, marginBottom = 20 } = {}) => {
      list.push({ id, node, keepWithNext, marginBottom });
    };

    const renderBasics = () => {
      if (!isVisible("basics")) return;
      const hasName = basics.name || basics.title;
      const contactItems = [
        { icon: Mail, text: basics.email },
        { icon: Phone, text: basics.phone },
        { icon: Briefcase, text: basics.status },
        { icon: MapPin, text: basics.location },
        { icon: Globe, text: basics.website },
        { icon: Calendar, text: basics.birthday },
      ].filter((i) => i.text);

      push(
        "basics",
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              style={{
                width: "68px",
                height: "68px",
                borderRadius: "8px",
                objectFit: "cover",
                flexShrink: 0,
              }}
            />
          )}
          {hasName && (
            <div style={{ flexShrink: 0 }}>
              {basics.name && (
                <div style={{ fontSize: "20pt", fontWeight: 800, color: themeColor, lineHeight: 1.2 }}>
                  {basics.name}
                </div>
              )}
              {basics.title && (
                <div style={{ fontSize: "11pt", color: "#64748b", marginTop: "4px" }}>
                  {basics.title}
                </div>
              )}
            </div>
          )}
          {contactItems.length > 0 && (
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "3px 16px",
              }}
            >
              {contactItems.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "10pt",
                    color: "#475569",
                  }}
                >
                  {item.icon && <item.icon size={13} style={{ flexShrink: 0, color: "#94a3b8" }} />}
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>,
        { marginBottom: 28 }
      );
    };

    const renderSkills = () => {
      if (!isVisible("skills") || !skillsContent || skillsContent === "<p></p>") return;
      const title = modMap.skills?.label || SECTION_TITLES.skills;
      push(`skills-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      push(`skills-body`, <HtmlContent html={skillsContent} />, { marginBottom: 20 });
    };

    const renderExperience = () => {
      if (!isVisible("experience") || !experience.length) return;
      const title = modMap.experience?.label || SECTION_TITLES.experience;
      push(`exp-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      experience.forEach((e, idx) => {
        push(
          `exp-${e.id}`,
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px" }}>
              <div>
                <strong style={{ fontSize: "11pt" }}>{e.company}</strong>
                {e.title && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{e.title}</span>}
              </div>
              <span style={{ fontSize: "9pt", color: "#9ca3af", whiteSpace: "nowrap" }}>
                {[e.start, e.end].filter(Boolean).join(" — ")}
              </span>
            </div>
            <HtmlContent html={e.description} />
          </div>,
          { marginBottom: idx === experience.length - 1 ? 20 : 14 }
        );
      });
    };

    const renderProjects = () => {
      if (!isVisible("projects") || !projects.length) return;
      const title = modMap.projects?.label || SECTION_TITLES.projects;
      push(`proj-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      projects.forEach((p, idx) => {
        push(
          `proj-${p.id}`,
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2px" }}>
              <div>
                <strong style={{ fontSize: "11pt" }}>{p.name}</strong>
                {p.role && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{p.role}</span>}
                {p.company && (
                  <span style={{ color: "#9ca3af", marginLeft: "8px", fontSize: "9pt" }}>@{p.company}</span>
                )}
              </div>
              <span style={{ fontSize: "9pt", color: "#9ca3af", whiteSpace: "nowrap" }}>
                {[p.start, p.end].filter(Boolean).join(" — ")}
              </span>
            </div>
            <HtmlContent html={p.description} />
          </div>,
          { marginBottom: idx === projects.length - 1 ? 20 : 14 }
        );
      });
    };

    const renderEducation = () => {
      if (!isVisible("education") || !education.length) return;
      const title = modMap.education?.label || SECTION_TITLES.education;
      push(`edu-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      education.forEach((e, idx) => {
        push(
          `edu-${e.id}`,
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <strong style={{ fontSize: "11pt" }}>{e.school}</strong>
                {e.degree && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{e.degree}</span>}
                {e.major && (
                  <span style={{ color: "#9ca3af", marginLeft: "8px", fontSize: "9pt" }}>{e.major}</span>
                )}
              </div>
              <span style={{ fontSize: "9pt", color: "#9ca3af", whiteSpace: "nowrap" }}>
                {[e.start, e.end].filter(Boolean).join(" — ")}
              </span>
            </div>
            {e.extras && (
              <div style={{ fontSize: "9pt", color: "#6b7280", marginTop: "2px" }}>{e.extras}</div>
            )}
          </div>,
          { marginBottom: idx === education.length - 1 ? 20 : 8 }
        );
      });
    };

    const renderCertificates = () => {
      const list = (certificates || []).filter((c) => c.name);
      if (!isVisible("certificates") || !list.length) return;
      const title = modMap.certificates?.label || SECTION_TITLES.certificates;
      push(`cert-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      list.forEach((c, idx) => {
        push(
          `cert-${c.id}`,
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <strong style={{ fontSize: "11pt" }}>{c.name}</strong>
                {c.issuer && <span style={{ color: "#6b7280", marginLeft: "8px" }}>{c.issuer}</span>}
              </div>
              <span style={{ fontSize: "9pt", color: "#9ca3af", whiteSpace: "nowrap" }}>
                {[c.date, c.expiry].filter(Boolean).join(" — ")}
              </span>
            </div>
            {(c.credentialId || c.note) && (
              <div style={{ fontSize: "9pt", color: "#6b7280", marginTop: "2px" }}>
                {[c.credentialId && `编号：${c.credentialId}`, c.note].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>,
          { marginBottom: idx === list.length - 1 ? 20 : 8 }
        );
      });
    };

    const renderLanguages = () => {
      const list = (languages || []).filter((l) => l.name);
      if (!isVisible("languages") || !list.length) return;
      const title = modMap.languages?.label || SECTION_TITLES.languages;
      push(`lang-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      list.forEach((l, idx) => {
        push(
          `lang-${l.id}`,
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span>
              <strong>{l.name}</strong>
              {l.level && <span style={{ color: "#6b7280", marginLeft: 8 }}>{l.level}</span>}
            </span>
            <span style={{ fontSize: "9pt", color: "#9ca3af" }}>
              {[l.cert, l.note].filter(Boolean).join(" · ")}
            </span>
          </div>,
          { marginBottom: idx === list.length - 1 ? 20 : 6 }
        );
      });
    };

    const renderHonors = () => {
      const list = (honors || []).filter((h) => h.title);
      if (!isVisible("honors") || !list.length) return;
      const title = modMap.honors?.label || SECTION_TITLES.honors;
      push(`honor-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      list.forEach((h, idx) => {
        push(
          `honor-${h.id}`,
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div>
              <strong>{h.title}</strong>
              {h.note && <span style={{ color: "#6b7280", marginLeft: 8, fontSize: "9pt" }}>{h.note}</span>}
            </div>
            {h.date && <span style={{ fontSize: "9pt", color: "#9ca3af", whiteSpace: "nowrap" }}>{h.date}</span>}
          </div>,
          { marginBottom: idx === list.length - 1 ? 20 : 6 }
        );
      });
    };

    const renderOthers = () => {
      if (!isVisible("others") || !othersContent || othersContent === "<p></p>") return;
      const title = modMap.others?.label || SECTION_TITLES.others;
      push(`others-title`, <SectionTitle title={title} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      push(`others-body`, <HtmlContent html={othersContent} />, { marginBottom: 20 });
    };

    const renderCustom = (mod) => {
      if (mod.visible === false) return;
      const content = customData[mod.id];
      if (!content || content === "<p></p>") return;
      push(`custom-title-${mod.id}`, <SectionTitle title={mod.label} color={themeColor} />, {
        keepWithNext: true,
        marginBottom: 0,
      });
      push(`custom-body-${mod.id}`, <HtmlContent html={content} />, { marginBottom: 20 });
    };

    const renderers = {
      basics: renderBasics,
      skills: renderSkills,
      experience: renderExperience,
      projects: renderProjects,
      education: renderEducation,
      certificates: renderCertificates,
      languages: renderLanguages,
      honors: renderHonors,
      others: renderOthers,
    };

    modules.forEach((mod) => {
      if (mod.id.startsWith("custom_")) {
        renderCustom(mod);
        return;
      }
      const fn = renderers[mod.id];
      if (fn) fn();
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    basics, skillsContent, othersContent, experience, projects, education,
    certificates, languages, honors,
    modules, customData, avatarUrl, themeColor,
  ]);

  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll("[data-rg-block]");
    const heights = [];
    const keeps = [];
    nodes.forEach((node, i) => {
      const style = window.getComputedStyle(node);
      const mt = parseFloat(style.marginTop) || 0;
      const mb = parseFloat(style.marginBottom) || 0;
      heights.push(node.offsetHeight + mt + mb);
      keeps.push(blocks[i]?.keepWithNext === true);
    });
    if (!heights.length) {
      setPageIndexLists([[]]);
      return;
    }
    setPageIndexLists(packPages(heights, keeps, CONTENT_H));
  }, [blocks, fontFamily]);

  const shell = pageShellStyle(fontFamily);

  return (
    <div className="rg-pv-wrap">
      {/* 离屏测量：与纸面同宽同字体，用于算块高 */}
      <div
        ref={measureRef}
        className="rg-pv-measure"
        aria-hidden="true"
        style={{
          ...shell,
          height: "auto",
          minHeight: 0,
          overflow: "visible",
          position: "absolute",
          left: "-10000px",
          top: 0,
          boxShadow: "none",
          pointerEvents: "none",
        }}
      >
        {blocks.map((b) => (
          <div
            key={`m-${b.id}`}
            data-rg-block={b.id}
            style={{ marginBottom: b.marginBottom }}
          >
            {b.node}
          </div>
        ))}
      </div>

      <div className="rg-pv-stage">
        <div
          className="rg-pv-scale"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
        >
          <div id="resume-preview-pages" className="rg-pv-pages">
            {pageIndexLists.map((indexes, pageIdx) => (
              <div
                key={`page-${pageIdx}`}
                className="rg-pv-page resume-preview-page"
                id={pageIdx === 0 ? "resume-preview-a4" : undefined}
                data-page={pageIdx + 1}
                style={{ ...shell, boxShadow: "0 2px 24px rgba(0,0,0,.12)" }}
              >
                {indexes.map((bi) => {
                  const b = blocks[bi];
                  if (!b) return null;
                  return (
                    <div key={`${pageIdx}-${b.id}`} style={{ marginBottom: b.marginBottom }}>
                      {b.node}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="rg-pv-zoom-bar" aria-label="预览缩放">
          <button type="button" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="缩小">
            <ZoomOut size={14} />
          </button>
          <span className="rg-pv-zoom-val">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="放大">
            <ZoomIn size={14} />
          </button>
          <span className="rg-pv-page-count">
            {Math.max(pageIndexLists.length, 1)} 页
          </span>
        </div>
      </div>
    </div>
  );
}
