import type { Editor } from "@tiptap/react";
import { ImageIcon, LinkIcon, TableIcon } from "./Icons.tsx";
import { useEditorState } from "@tiptap/react";
import type React from "react";
import { useRef } from "react";

interface ToolbarProps {
  editor: Editor;
  onToggleAllCollapsibles: (open: boolean) => void;
}

interface ToolButtonProps {
  label: React.ReactNode;
  title: string;
  active?: boolean;
  onClick: () => void;
}

function Tool({ label, title, active, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={active ? "tool is-active" : "tool"}
      title={title}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function Toolbar({ editor, onToggleAllCollapsibles }: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      strike: instance.isActive("strike"),
      code: instance.isActive("code"),
      highlight: instance.isActive("highlight"),
      link: instance.isActive("link"),
      h1: instance.isActive("heading", { level: 1 }),
      h2: instance.isActive("heading", { level: 2 }),
      h3: instance.isActive("heading", { level: 3 }),
      bullet: instance.isActive("bulletList"),
      ordered: instance.isActive("orderedList"),
      task: instance.isActive("taskList"),
      quote: instance.isActive("blockquote"),
      codeBlock: instance.isActive("codeBlock"),
      collapsible: instance.isActive("collapsible"),
    }),
  });

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL (empty to remove)", previous ?? "https://");
    if (href === null) {
      return;
    }
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };

  return (
    <div className="toolbar">
      <Tool label="H1" title="Heading 1" active={state.h1} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <Tool label="H2" title="Heading 2" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Tool label="H3" title="Heading 3" active={state.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <span className="tool-sep" />
      <Tool label="B" title="Bold — ⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Tool label="I" title="Italic — ⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Tool label="S" title="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Tool label="◍" title="Highlight" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()} />
      <Tool label="‹›" title="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
      <Tool label={<LinkIcon />} title="Link" active={state.link} onClick={setLink} />
      <span className="tool-sep" />
      <Tool label="•" title="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Tool label="1." title="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Tool label="☑" title="Task list" active={state.task} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Tool label="❝" title="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Tool label="{ }" title="Code block" active={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <span className="tool-sep" />
      <Tool
        label="▾ Section"
        title="Collapsible section — ⌘⇧D (or type >>> )"
        active={state.collapsible}
        onClick={() =>
          state.collapsible
            ? editor.chain().focus().unsetCollapsible().run()
            : editor.chain().focus().setCollapsible().run()
        }
      />
      <Tool label="Collapse all" title="Collapse every section" onClick={() => onToggleAllCollapsibles(false)} />
      <Tool label="Expand all" title="Expand every section" onClick={() => onToggleAllCollapsibles(true)} />
      <span className="tool-sep" />
      <Tool label={<ImageIcon />} title="Insert image" onClick={() => fileInput.current?.click()} />
      <Tool label={<TableIcon />} title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Tool label="―" title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          Array.from(event.target.files ?? []).forEach((file) => editor.commands.insertLocalImage(file));
          event.target.value = "";
        }}
      />
    </div>
  );
}
