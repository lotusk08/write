import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { CENTER_ROW } from "../editor/extensions/blogFormat.ts";
import { embedFromUrl } from "../editor/extensions/embed.ts";
import type { NoteType } from "../editor/extensions/noteQuote.ts";
import { Icon, type IconName } from "./Icons.tsx";
import { NoteMenu } from "./NoteMenu.tsx";

/** Blocks the centre-row attribute can sit on, in the order it is looked for. */
const CENTERABLE = ["image", "paragraph", "blockquote", "heading", "table"];

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

/** How much of the row is still off to one side before it counts as more. */
const EDGE_SLACK = 2;

export function Toolbar({ editor, onToggleAllCollapsibles }: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);

  // A phone cannot show two dozen tools at once, so the row scrolls — and says
  // so by fading out on whichever side it still has tools on. Nothing else
  // marks the edge: a touch screen draws no scrollbar.
  useEffect(() => {
    const element = row.current;
    if (!element) {
      return;
    }
    const sync = () => {
      const hidden = element.scrollWidth - element.clientWidth;
      const start = element.scrollLeft > EDGE_SLACK;
      const end = element.scrollLeft < hidden - EDGE_SLACK;
      element.dataset.more = start && end ? "both" : start ? "start" : end ? "end" : "none";
    };
    sync();
    element.addEventListener("scroll", sync, { passive: true });
    // The dock is what changes width — the rail, focus mode, the window.
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, []);

  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      strike: instance.isActive("strike"),
      code: instance.isActive("code"),
      filepath: instance.isActive("code", { filepath: true }),
      // The blog's `{: .d-flex .c-center }`, wherever the cursor is sitting.
      centered: CENTERABLE.some((type) => instance.getAttributes(type).blockIal === CENTER_ROW),
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

  /** Takes the page URL and works out the include the blog needs. */
  const insertEmbed = () => {
    const url = window.prompt(
      "Video or post URL (YouTube, X, Bilibili, Spotify, Twitch)",
      "https://www.youtube.com/watch?v=",
    );
    if (!url) {
      return;
    }
    const embed = embedFromUrl(url);
    if (!embed) {
      window.alert(`Could not find a video id in: ${url}`);
      return;
    }
    editor.chain().focus().setEmbed(embed).run();
  };

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
    <div ref={row} className="toolbar" role="toolbar" aria-label="Formatting">
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
        <Tool
          icon="file"
          title="File path — the blog's {: .filepath}"
          active={state.filepath}
          onClick={() =>
            editor
              .chain()
              .focus()
              .setCode()
              .updateAttributes("code", { filepath: !state.filepath })
              .run()
          }
        />
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
        <Tool icon="video" title="Embed a video — YouTube, X, Spotify…" onClick={insertEmbed} />
        <Tool
          icon="table"
          title="Insert table"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        />
        <Tool icon="rule" title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
        <Tool
          icon="center"
          title="Centre this block — the blog's {: .d-flex .c-center }"
          active={state.centered}
          onClick={() => editor.chain().focus().toggleBlockAttributes(CENTER_ROW).run()}
        />
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
