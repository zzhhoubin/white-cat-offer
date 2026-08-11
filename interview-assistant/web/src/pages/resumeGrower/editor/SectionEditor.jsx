import React from "react";
import { useResumeStore } from "./store.js";
import BasicsEditor from "./editors/BasicsEditor.jsx";
import SkillsEditor from "./editors/SkillsEditor.jsx";
import ExperienceEditor from "./editors/ExperienceEditor.jsx";
import ProjectsEditor from "./editors/ProjectsEditor.jsx";
import EducationEditor from "./editors/EducationEditor.jsx";
import CertificatesEditor from "./editors/CertificatesEditor.jsx";
import LanguagesEditor from "./editors/LanguagesEditor.jsx";
import HonorsEditor from "./editors/HonorsEditor.jsx";
import OthersEditor from "./editors/OthersEditor.jsx";
import CustomEditor from "./editors/CustomEditor.jsx";

export default function SectionEditor() {
  const activeSection = useResumeStore((s) => s.activeSection);

  if (!activeSection) {
    return (
      <div className="rg-editor-empty">
        <p>👈 从左侧选择一个模块开始编辑</p>
      </div>
    );
  }

  switch (activeSection) {
    case "basics":
      return <BasicsEditor />;
    case "skills":
      return <SkillsEditor />;
    case "experience":
      return <ExperienceEditor />;
    case "projects":
      return <ProjectsEditor />;
    case "education":
      return <EducationEditor />;
    case "certificates":
      return <CertificatesEditor />;
    case "languages":
      return <LanguagesEditor />;
    case "honors":
      return <HonorsEditor />;
    case "others":
      return <OthersEditor />;
    default:
      if (activeSection.startsWith("custom_")) {
        return <CustomEditor moduleId={activeSection} />;
      }
      return <div className="rg-editor-empty"><p>未知模块</p></div>;
  }
}
