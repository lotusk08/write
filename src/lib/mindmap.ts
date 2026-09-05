import type { JSONContent } from "@tiptap/core";
import { isLocalSrc } from "./db.ts";
import { docToMarkdown } from "./markdown.ts";
import { displaySrc } from "./site.ts";

export const THINK_URL = "https://think.stevehoang.com";

type Mark = { type: string; attrs?: Record<string, unknown> };

function cleanMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks?.some((mark) => mark.type === "code" && mark.attrs?.filepath)) {
    return marks;
  }
  return marks.map((mark) =>
    mark.type === "code" ? { ...mark, attrs: { ...mark.attrs, filepath: false } } : mark,
  );
}

function clean(node: JSONContent): JSONContent | null {
  if (node.type === "embed") {
    return null;
  }
  const out: JSONContent = { ...node };
  if (out.attrs && (out.attrs.ial || out.attrs.blockIal || out.attrs.note)) {
    out.attrs = { ...out.attrs, ial: null, blockIal: null, note: null };
  }
  if (node.type === "image") {
    const src = String(node.attrs?.src ?? "");
    if (isLocalSrc(src)) {
      const alt = String(node.attrs?.alt ?? "").trim();
      return alt ? { type: "paragraph", content: [{ type: "text", text: alt }] } : null;
    }
    out.attrs = { ...out.attrs, src: displaySrc(src) };
  }
  if (node.marks) {
    out.marks = cleanMarks(node.marks as Mark[]);
  }
  if (node.content) {
    out.content = node.content
      .flatMap((child) => (child.type === "gallery" ? (child.content ?? []) : [child]))
      .map(clean)
      .filter((child): child is JSONContent => child !== null);
  }
  return out;
}

export function mindmapUrl(doc: JSONContent, title: string): string {
  const cleaned = clean(doc) ?? { type: "doc", content: [] };
  const body = docToMarkdown(cleaned);
  const heading = title.trim();
  const markdown = heading ? `# ${heading}\n\n${body}` : body;
  return `${THINK_URL}/#${encodeURI(markdown)}`;
}
