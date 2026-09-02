import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "./Icons.tsx";

export interface OutlineEntry {
  level: number;
  text: string;
  pos: number;
}

export interface Outline {
  entries: OutlineEntry[];
  active: number | null;
  scrolled: boolean;
  go: (entry: OutlineEntry) => void;
}

const NONE: OutlineEntry[] = [];
const ACTIVE_OFFSET_PX = 64;
const SETTLE_MS = 120;
const ASIDE_GAP_PX = 12;
const JUMP_MS = 320;
const JUMP_MARGIN_PX = 40;

function jumpTo(container: HTMLElement, to: number): boolean {
  const from = container.scrollTop;
  const target = Math.max(0, Math.min(to, container.scrollHeight - container.clientHeight));
  const delta = target - from;
  if (!delta || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    container.scrollTop = target;
    return false;
  }
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  container.addEventListener("wheel", cancel, { passive: true, once: true });
  container.addEventListener("touchstart", cancel, { passive: true, once: true });
  const start = performance.now();
  const step = (now: number) => {
    if (cancelled) {
      return;
    }
    const t = Math.min(1, (now - start) / JUMP_MS);
    container.scrollTop = from + delta * (1 - (1 - t) ** 3);
    if (t < 1) {
      window.requestAnimationFrame(step);
    } else {
      container.removeEventListener("wheel", cancel);
      container.removeEventListener("touchstart", cancel);
    }
  };
  window.requestAnimationFrame(step);
  return true;
}

function headings(editor: Editor | null): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  editor?.state.doc.descendants((node, pos) => {
    const level = Number(node.attrs.level);
    if (node.type.name === "heading" && level >= 2 && level <= 4) {
      out.push({ level, text: node.textContent, pos });
    }
  });
  return out;
}

function sameOutline(a: OutlineEntry[], b: OutlineEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return entry.level === other.level && entry.text === other.text && entry.pos === other.pos;
    })
  );
}

export function useOutline(
  editor: Editor | null,
  scrollRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): Outline {
  const entries =
    useEditorState({
      editor,
      selector: ({ editor: instance }) => (enabled ? headings(instance) : []),
      equalityFn: (a: OutlineEntry[], b: OutlineEntry[] | null) => b !== null && sameOutline(a, b),
    }) ?? NONE;
  const [active, setActive] = useState<number | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const frame = useRef<number | undefined>(undefined);
  const settle = useRef<number | undefined>(undefined);
  const jumping = useRef(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (!editor || !container || !enabled) {
      setActive(null);
      setScrolled(false);
      return;
    }
    const measure = () => {
      frame.current = undefined;
      const edge = container.getBoundingClientRect().top;
      const top = edge + ACTIVE_OFFSET_PX;
      let found: number | null = null;
      for (const entry of entries) {
        const dom = editor.view.nodeDOM(entry.pos);
        if (!(dom instanceof HTMLElement)) {
          continue;
        }
        const rect = dom.getBoundingClientRect();
        if (rect.height === 0) {
          continue;
        }
        if (rect.top > top) {
          break;
        }
        found = entry.pos;
      }
      setActive(found ?? entries[0]?.pos ?? null);
      const title = container.querySelector(".title-input");
      setScrolled(title ? title.getBoundingClientRect().bottom < edge : container.scrollTop > 0);
    };
    const schedule = () => {
      if (jumping.current) {
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          jumping.current = false;
          measure();
        }, SETTLE_MS);
        return;
      }
      frame.current ??= window.requestAnimationFrame(measure);
    };
    schedule();
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      window.clearTimeout(settle.current);
      if (frame.current !== undefined) {
        window.cancelAnimationFrame(frame.current);
        frame.current = undefined;
      }
    };
  }, [editor, entries, enabled, scrollRef]);

  const go = useCallback(
    (entry: OutlineEntry) => {
      if (!editor) {
        return;
      }
      const dom = editor.view.nodeDOM(entry.pos);
      const container = scrollRef.current;
      const chain = editor.chain().setTextSelection(entry.pos + 1);
      if (window.matchMedia("(pointer: fine)").matches) {
        chain.focus(undefined, { scrollIntoView: false });
      }
      chain.run();
      setActive(entry.pos);
      if (!(dom instanceof HTMLElement) || !container) {
        return;
      }
      jumping.current = true;
      window.clearTimeout(settle.current);
      const to =
        dom.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        JUMP_MARGIN_PX;
      if (!jumpTo(container, to)) {
        jumping.current = false;
      }
    },
    [editor, scrollRef],
  );

  return { entries, active, scrolled, go };
}

function TocList({ outline, onPick }: { outline: Outline; onPick?: () => void }) {
  return (
    <ul className="toc-list">
      {outline.entries.map((entry) => (
        <li key={entry.pos}>
          <button
            type="button"
            className={
              entry.pos === outline.active
                ? `toc-link level-${entry.level} is-active`
                : `toc-link level-${entry.level}`
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              outline.go(entry);
              onPick?.();
            }}
          >
            {entry.text || "Heading"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TocAside({ outline }: { outline: Outline }) {
  const aside = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = aside.current;
    const link = element?.querySelector<HTMLElement>(".toc-link.is-active");
    if (!element || !link) {
      return;
    }
    const top = link.offsetTop - ASIDE_GAP_PX;
    const bottom = link.offsetTop + link.offsetHeight + ASIDE_GAP_PX;
    if (top < element.scrollTop) {
      element.scrollTop = top;
    } else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [outline.active]);

  if (!outline.entries.length) {
    return null;
  }
  return (
    <aside className="toc-wrapper" ref={aside}>
      <nav className="toc" aria-label="Contents">
        <TocList outline={outline} />
      </nav>
    </aside>
  );
}

export function TocBar({ outline, title }: { outline: Outline; title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  if (!outline.entries.length) {
    return null;
  }
  const current = outline.entries.find((entry) => entry.pos === outline.active);
  const label = current?.text || title || "Contents";

  return (
    <>
      <div className={outline.scrolled ? "toc-bar is-visible" : "toc-bar"}>
        <span className="toc-label">{label}</span>
        <button
          type="button"
          className="tool"
          title="Contents"
          aria-label="Open the table of contents"
          onClick={() => setOpen(true)}
        >
          <Icon name="bulletList" />
        </button>
      </div>
      <dialog ref={dialog} className="toc-popup" onClose={() => setOpen(false)}>
        <div className="toc-popup-head">
          <span className="toc-label">{title || "Contents"}</span>
          <button
            type="button"
            className="tool"
            title="Close"
            aria-label="Close the table of contents"
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="toc-popup-body">
          <TocList outline={outline} onPick={() => setOpen(false)} />
        </div>
      </dialog>
    </>
  );
}
