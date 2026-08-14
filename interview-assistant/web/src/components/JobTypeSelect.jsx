import { useEffect, useRef, useState } from "react";
import { JOB_TREE } from "../data/jobTree.js";

const SELECT_CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath stroke='%236b7280' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='M2 2.5L6 6.5L10 2.5'/%3E%3C/svg%3E\")";

/**
 * 三级职位选择：左栏一级大类，右栏二级分组标题 + 三级职位标签
 * onChange(l1, l2, l3)
 */
export default function JobTypeSelect({ l1, l2, l3, onChange, open, setOpen }) {
  const triggerRef = useRef(null);
  const popRef = useRef(null);
  const [hoverL1, setHoverL1] = useState(l1 || JOB_TREE[0].l1);
  const activeL1 = open ? hoverL1 || l1 || JOB_TREE[0].l1 : l1 || hoverL1 || JOB_TREE[0].l1;
  const groups = JOB_TREE.find((x) => x.l1 === activeL1)?.groups || [];
  const label = l1 && l2 && l3 ? `${l1} > ${l2} > ${l3}` : "";

  useEffect(() => {
    if (open) setHoverL1(l1 || JOB_TREE[0].l1);
  }, [open, l1]);

  useEffect(() => {
    if (!open) return undefined;
    function place() {
      const trigger = triggerRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 4;
      const width = Math.min(720, Math.max(rect.width, 560));
      const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
      const spaceAbove = rect.top - gap - 8;
      const preferBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove;
      const avail = preferBelow ? spaceBelow : spaceAbove;
      const height = Math.min(520, Math.max(240, avail));
      pop.style.width = `${width}px`;
      pop.style.height = `${height}px`;
      pop.style.maxHeight = `${height}px`;
      pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      pop.style.top = preferBelow
        ? `${rect.bottom + gap}px`
        : `${Math.max(8, rect.top - gap - height)}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, activeL1]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (triggerRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, setOpen]);

  return (
    <div className="rt-v2-job">
      <button
        type="button"
        className={`rt-v2-job-trigger${open ? " open" : ""}`}
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        style={{ backgroundImage: SELECT_CARET }}
      >
        {label ? <span>{label}</span> : <span className="rt-v2-ms-ph">请选择</span>}
      </button>
      {open && (
        <div className="rt-v2-job-pop rt-v2-job-pop-3" ref={popRef}>
          <div className="rt-v2-job-col rt-v2-job-col-l1">
            {JOB_TREE.map((item) => (
              <button
                type="button"
                key={item.l1}
                className={`rt-v2-job-opt${item.l1 === l1 ? " on" : ""}${item.l1 === activeL1 ? " hover" : ""}`}
                onMouseEnter={() => setHoverL1(item.l1)}
                onClick={() => setHoverL1(item.l1)}
              >
                <span>{item.l1}</span>
                {item.l1 === l1 && <span className="tick">✓</span>}
              </button>
            ))}
          </div>
          <div className="rt-v2-job-col rt-v2-job-col-detail">
            {groups.map((g) => (
              <div className="rt-v2-job-group" key={g.l2}>
                <div className="rt-v2-job-group-title">{g.l2}</div>
                <div className="rt-v2-job-tags">
                  {(g.l3 || []).map((name) => {
                    const selected = activeL1 === l1 && g.l2 === l2 && name === l3;
                    return (
                      <button
                        type="button"
                        key={`${g.l2}::${name}`}
                        className={`rt-v2-job-tag${selected ? " on" : ""}`}
                        onClick={() => {
                          onChange(activeL1, g.l2, name);
                          setOpen(false);
                        }}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
