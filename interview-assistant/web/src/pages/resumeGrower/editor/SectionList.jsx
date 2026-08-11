import React, { useState } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  User, Wrench, Briefcase, FolderGit2, GraduationCap,
  Award, Languages, Trophy, FileText,
  GripVertical, Eye, EyeOff, Plus, Trash2,
} from "lucide-react";
import { useResumeStore } from "./store.js";
import ColorPicker from "./ColorPicker.jsx";
import FontPicker from "./FontPicker.jsx";

const ICON_MAP = {
  User, Wrench, Briefcase, FolderGit2, GraduationCap,
  Award, Languages, Trophy, FileText,
};

function SortableModule({ mod, isActive, onToggleVisible, onClick, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: mod.id });
  const Icon = ICON_MAP[mod.icon] || User;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rg-sidel-item${isActive ? " active" : ""}`}
      onClick={() => onClick(mod.id)}
    >
      <button type="button" className="rg-sidel-drag" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      <Icon size={16} className="rg-sidel-icon" />
      <span className="rg-sidel-name">{mod.label}</span>
      <button
        type="button"
        className="rg-sidel-del"
        onClick={(e) => { e.stopPropagation(); onRemove(mod.id); }}
        title="删除模块"
      >
        <Trash2 size={13} />
      </button>
      <button
        type="button"
        className={`rg-sidel-eye${mod.visible ? "" : " off"}`}
        onClick={(e) => { e.stopPropagation(); onToggleVisible(mod.id); }}
        title={mod.visible ? "隐藏" : "显示"}
      >
        {mod.visible ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
    </div>
  );
}

export default function SectionList() {
  const {
    modules, activeSection, setActiveSection,
    toggleModuleVisible, reorderModules, addCustomModule, removeModule,
    themeColor, setThemeColor, fontFamily, setFontFamily,
  } = useResumeStore();

  const [adding, setAdding] = useState(false);
  const [customLabel, setCustomLabel] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = modules.findIndex((m) => m.id === active.id);
    const newIndex = modules.findIndex((m) => m.id === over.id);
    const next = [...modules];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    reorderModules(next);
  }

  function handleAddCustom() {
    if (!customLabel.trim()) return;
    addCustomModule(customLabel.trim(), "User");
    setCustomLabel("");
    setAdding(false);
  }

  return (
    <div className="rg-sidel">
      {/* 模块导航 */}
      <div className="rg-sidel-sec">
        <h3 className="rg-sidel-label">模块</h3>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
            <nav className="rg-sidel-nav">
              {modules.map((m) => (
                <SortableModule
                  key={m.id}
                  mod={m}
                  isActive={activeSection === m.id}
                  onToggleVisible={toggleModuleVisible}
                  onClick={setActiveSection}
                  onRemove={removeModule}
                />
              ))}
            </nav>
          </SortableContext>
        </DndContext>

        {/* 添加自定义模块 */}
        {adding ? (
          <div className="rg-sidel-add-form">
            <input
              autoFocus
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddCustom(); if (e.key === "Escape") setAdding(false); }}
              placeholder="模块名称"
            />
            <button type="button" className="btn small primary" onClick={handleAddCustom}>确定</button>
            <button type="button" className="btn small mute" onClick={() => setAdding(false)}>取消</button>
          </div>
        ) : (
          <button type="button" className="rg-sidel-add-btn" onClick={() => setAdding(true)}>
            <Plus size={14} /> 添加自定义模块
          </button>
        )}
      </div>

      {/* 主题色 */}
      <div className="rg-sidel-sec">
        <h3 className="rg-sidel-label">主题色</h3>
        <ColorPicker value={themeColor} onChange={setThemeColor} />
      </div>

      {/* 字体 */}
      <div className="rg-sidel-sec">
        <h3 className="rg-sidel-label">字体</h3>
        <FontPicker value={fontFamily} onChange={setFontFamily} />
      </div>
    </div>
  );
}
