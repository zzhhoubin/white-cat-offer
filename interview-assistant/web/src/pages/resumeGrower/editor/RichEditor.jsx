import React, { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";

const MENU_BUTTONS = [
  { action: "bold", label: "B", title: "加粗", cls: "bold" },
  { action: "italic", label: "I", title: "斜体", cls: "italic" },
  { action: "bulletList", label: "•", title: "无序列表", cls: "" },
  { action: "orderedList", label: "1.", title: "有序列表", cls: "" },
];

export default function RichEditor({ content, onChange, placeholder }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || "描述工作内容和成果..." }),
    ],
    content: content || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // sync external content changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || "");
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="rg-rich-wrap">
      <div className="rg-rich-toolbar">
        {MENU_BUTTONS.map((btn) => (
          <button
            key={btn.action}
            type="button"
            className={`rg-rich-btn${editor.isActive(btn.action) ? " active" : ""}${btn.cls ? " rg-rich-" + btn.cls : ""}`}
            title={btn.title}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus()[btn.action === "bulletList" || btn.action === "orderedList"
                ? "toggle" + btn.action.charAt(0).toUpperCase() + btn.action.slice(1)
                : "toggle" + btn.action.charAt(0).toUpperCase() + btn.action.slice(1)]().run();
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="rg-rich-content" />
    </div>
  );
}
