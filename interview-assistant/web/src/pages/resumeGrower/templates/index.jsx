import React from "react";
import { TemplateProvider } from "./TemplateContext.jsx";
import { getTemplateComponent } from "./registry";

/**
 * 桥接组件 —— 仿 magic-resume ResumeTemplateComponent
 * 根据 templateConfig.id 动态选择模板组件，包裹 TemplateProvider 传递上下文
 */
export default function ResumeTemplateComponent({ templateConfig, blocks, annotations, activeAnno, onAnnoClick }) {
  const Component = getTemplateComponent(templateConfig?.id);
  if (!Component) {
    return <div className="rg-paper-empty">模板加载失败</div>;
  }

  return (
    <TemplateProvider templateId={templateConfig.id}>
      <Component
        blocks={blocks}
        config={templateConfig}
        annotations={annotations}
        activeAnno={activeAnno}
        onAnnoClick={onAnnoClick}
      />
    </TemplateProvider>
  );
}
