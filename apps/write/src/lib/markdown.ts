import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";

export interface SerializeOptions {
  /** Maps an editor image src (often `local:<id>`) to its final URL. */
  resolveImage?: (src: string) => string;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length || !text) {
    return text;
  }
  // `code` wins: Markdown cannot nest emphasis inside a code span.
  if (marks.some((mark) => mark.type === "code")) {
    const fence = text.includes("`") ? "``" : "`";
    const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
    return `${fence}${padding}${text}${padding}${fence}`;
  }

  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "underline":
        out = `<u>${out}</u>`;
        break;
      case "highlight":
        out = `<mark>${out}</mark>`;
        break;
      case "link": {
        const href = String(mark.attrs?.href ?? "");
        const title = mark.attrs?.title ? ` "${String(mark.attrs.title)}"` : "";
        out = `[${out}](${href}${title})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function inline(nodes: JSONContent[] | undefined, options: SerializeOptions): string {
  if (!nodes?.length) {
    return "";
  }
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return applyMarks(escapeText(node.text ?? ""), node.marks as Mark[] | undefined);
      }
      if (node.type === "hardBreak") {
        return "  \n";
      }
      if (node.type === "image") {
        return image(node, options);
      }
      // Unknown inline node: fall back to its text content.
      return inline(node.content, options);
    })
    .join("");
}

function image(node: JSONContent, options: SerializeOptions): string {
  const rawSrc = String(node.attrs?.src ?? "");
  const src = options.resolveImage ? options.resolveImage(rawSrc) : rawSrc;
  const alt = String(node.attrs?.alt ?? "").replace(/[[\]]/g, "");
  const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : "";
  return `![${alt}](${src}${title})`;
}

function indentContinuation(block: string, indent: string): string {
  return block
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : indent + line))
    .join("\n");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

function listBlock(node: JSONContent, options: SerializeOptions, ordered: boolean): string {
  const items = node.content ?? [];
  const start = Number(node.attrs?.start ?? 1);
  return items
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const checkbox =
        item.type === "taskItem" ? (item.attrs?.checked ? "[x] " : "[ ] ") : "";
      const indent = " ".repeat(marker.length);
      // Nested lists hug their parent item; other blocks stay loose.
      const body = (item.content ?? []).reduce((text, child, position) => {
        const rendered = blocks([child], options).join("\n\n");
        if (position === 0) {
          return rendered;
        }
        return `${text}${LIST_TYPES.has(child.type ?? "") ? "\n" : "\n\n"}${rendered}`;
      }, "");
      return marker + checkbox + indentContinuation(body, indent);
    })
    .join("\n");
}

function tableBlock(node: JSONContent, options: SerializeOptions): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      blocks(cell.content, options)
        .join(" ")
        .replace(/\n+/g, " ")
        .replace(/\|/g, "\\|")
        .trim(),
    ),
  );
  if (!rows.length) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  return [pad(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map(pad)].join("\n");
}

function collapsibleBlock(node: JSONContent, options: SerializeOptions): string {
  const summaryNode = node.content?.find((child) => child.type === "collapsibleSummary");
  const contentNode = node.content?.find((child) => child.type === "collapsibleContent");
  const summary = inline(summaryNode?.content, options).trim() || "Details";
  const body = blocks(contentNode?.content, options).join("\n\n");
  const open = node.attrs?.open ? " open" : "";
  // `markdown="1"` keeps Kramdown (Jekyll) parsing the body as Markdown.
  return `<details markdown="1"${open}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

function blocks(nodes: JSONContent[] | undefined, options: SerializeOptions): string[] {
  if (!nodes?.length) {
    return [];
  }
  const out: string[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "paragraph": {
        const text = inline(node.content, options);
        out.push(text);
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
        out.push(`${"#".repeat(level)} ${inline(node.content, options)}`);
        break;
      }
      case "blockquote": {
        const inner = blocks(node.content, options).join("\n\n");
        out.push(
          inner
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n"),
        );
        break;
      }
      case "bulletList":
        out.push(listBlock(node, options, false));
        break;
      case "taskList":
        out.push(listBlock(node, options, false));
        break;
      case "orderedList":
        out.push(listBlock(node, options, true));
        break;
      case "codeBlock": {
        const language = String(node.attrs?.language ?? "");
        const code = (node.content ?? []).map((child) => child.text ?? "").join("");
        out.push(`\`\`\`${language}\n${code}\n\`\`\``);
        break;
      }
      case "horizontalRule":
        out.push("---");
        break;
      case "image":
        out.push(image(node, options));
        break;
      case "table":
        out.push(tableBlock(node, options));
        break;
      case "collapsible":
        out.push(collapsibleBlock(node, options));
        break;
      case "listItem":
      case "taskItem":
      case "collapsibleContent":
        out.push(...blocks(node.content, options));
        break;
      default:
        if (node.content) {
          out.push(...blocks(node.content, options));
        }
        break;
    }
  }

  return out.filter((block) => block !== undefined);
}

/** Serializes a Tiptap document to Markdown (no front matter). */
export function docToMarkdown(doc: JSONContent, options: SerializeOptions = {}): string {
  return blocks(doc.content, options)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text, used for word counts and DOCX fallbacks. */
export function docToPlainText(doc: JSONContent): string {
  const parts: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.text) {
      parts.push(node.text);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return parts.join(" ");
}

function yamlString(value: string): string {
  if (value === "") {
    return "";
  }
  const needsQuotes = /^[\s>|&*!%@`{}[\]#-]|[:#]\s|["']|\n|:$/.test(value);
  return needsQuotes ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value;
}

function yamlList(values: string[]): string {
  return `[${values.map((value) => yamlString(value)).join(", ")}]`;
}

/** Builds the Jekyll front matter block the blog expects. */
export function buildFrontMatter(meta: PostMeta): string {
  const lines = [
    "---",
    `title: ${yamlString(meta.title)}`,
    `description: ${yamlString(meta.description)}`,
    `author: ${yamlString(meta.author)}`,
    `date: ${meta.date}`,
    `categories: ${yamlList(meta.categories)}`,
    `tags: ${yamlList(meta.tags)}`,
    `pin: ${meta.pin}`,
    `toc: ${meta.toc}`,
    `math: ${meta.math}`,
    `mermaid: ${meta.mermaid}`,
  ];
  if (meta.cover?.path) {
    lines.push("image:", `  path: ${yamlString(meta.cover.path)}`, `  alt: ${yamlString(meta.cover.alt)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildPostFile(meta: PostMeta, doc: JSONContent, options: SerializeOptions = {}): string {
  return `${buildFrontMatter(meta)}\n${docToMarkdown(doc, options)}\n`;
}
