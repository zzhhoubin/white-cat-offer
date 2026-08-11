import { createContext, useContext } from "react";

export const TemplateContext = createContext(null);

export function TemplateProvider({ templateId, children }) {
  return <TemplateContext.Provider value={{ templateId }}>{children}</TemplateContext.Provider>;
}

export function useTemplateContext() {
  return useContext(TemplateContext);
}
