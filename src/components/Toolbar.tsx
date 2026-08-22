import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import type { NoteType } from "../editor/extensions/noteQuote.ts";
import { Icon, type IconName } from "./Icons.tsx";
import { NoteMenu } from "./NoteMenu.tsx";

interface ToolbarProps {
  editor: Editor;
  onToggleAllCollapsibles: (open: boolean) => void;
}

interface ToolProps {
  title: string;
  onClick: () => void;
  icon?: IconName;
  label?: ReactNode;
  active?: boolean;
}

function Tool({ title, onClick, icon, label, active }: ToolProps) {
  return (
    <button
      type="button"
      className={active ? "tool is-active" : "tool"}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : <span className="tool-text">{label}</span>}
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
      h2: instance.isActive("heading", { level: 2 }),
      h3: instance.isActive("heading", { level: 3 }),
      h4: instance.isActive("heading", { level: 4 }),
      bullet: instance.isActive("bulletList"),
      ordered: instance.isActive("orderedList"),
      task: instance.isActive("taskList"),
      quote: instance.isActive("blockquote"),
      note: (instance.getAttributes("blockquote").note ?? null) as NoteType | null,
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
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="tool-group">
        {/* The post title is front matter, so the body starts at H2 — the
            level the blog's own posts and table of contents use. */}
        {([2, 3, 4] as const).map((level) => (
          <Tool
            key={level}
            label={`H${level}`}
            title={`Heading ${level}`}
            active={state[`h${level}` as "h2" | "h3" | "h4"]}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          />
        ))}
      </div>

      <span className="tool-sep" />

      <div className="tool-group">
        <Tool icon="bold" title="Bold — ⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Tool icon="italic" title="Italic — ⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Tool icon="strike" title="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Tool icon="highlight" title="Highlight" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()} />
        <Tool icon="code" title="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />
        <Tool icon="link" title="Link" active={state.link} onClick={setLink} />
      </div>

      <span className="tool-sep" />

      <div className="tool-group">
        <Tool icon="bulletList" title="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool icon="orderedList" title="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        <Tool icon="taskList" title="Task list" active={state.task} onClick={() => editor.chain().focus().toggleTaskList().run()} />
        <NoteMenu editor={editor} active={state.quote} note={state.note} />
        <Tool icon="codeBlock" title="Code block" active={state.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      </div>

      <span className="tool-sep" />

      <div className="tool-group">
        <Tool
          icon="section"
          title="Collapsible section — ⌘⇧D, or type >>>"
          active={state.collapsible}
          onClick={() =>
            state.collapsible
              ? editor.chain().focus().unsetCollapsible().run()
              : editor.chain().focus().setCollapsible().run()
          }
        />
        <Tool icon="collapseAll" title="Collapse every section" onClick={() => onToggleAllCollapsibles(false)} />
        <Tool icon="expandAll" title="Expand every section" onClick={() => onToggleAllCollapsibles(true)} />
      </div>

      <span className="tool-sep" />

      <div className="tool-group">
        <Tool icon="image" title="Insert image" onClick={() => fileInput.current?.click()} />
        <Tool
          icon="table"
          title="Insert table"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
        <Tool icon="rule" title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      </div>

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
