import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";
import { embedLiquid } from "../editor/extensions/embed.ts";

export interface SerializeOptions {
  resolveImage?: (src: string) => string;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function escapeText(text: string): string {
  return text
    .split(/(\[\^[^\]\s]+\])/)
    .map((part, index) => (index % 2 ? part : part.replace(/([\\`*_[\]<>])/g, "\\$1")))
    .join("");
}

function applyMarks(text: string, marks: Mark[] | undefined): string {
  if (!marks?.length || !text) {
    return text;
  }
  const code = marks.find((mark) => mark.type === "code");
  if (code) {
    const fence = text.includes("`") ? "``" : "`";
    const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
    const filepath = code.attrs?.filepath ? "{: .filepath}" : "";
    const span = `${fence}${padding}${text}${padding}${fence}${filepath}`;
    const link = marks.find((mark) => mark.type === "link");
    if (!link) {
      return span;
    }
    const href = String(link.attrs?.href ?? "");
    const title = link.attrs?.title ? ` "${String(link.attrs.title)}"` : "";
    return `[${span}](${href}${title})`;
  }

  let out = text;
  for (const mark of [...marks].reverse()) {
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

function nextLine(block: string, addition: string): string {
  const leadingBreak = /^[ \t]{2,}\n/.exec(addition);
  if (leadingBreak) {
    return block + addition;
  }
  return block.endsWith("\n") ? block + addition : `${block}\n${addition}`;
}

function withoutEdgeBreaks(
  nodes: JSONContent[] | undefined,
  keepLeading: boolean,
  keepTrailing: boolean,
): JSONContent[] | undefined {
  if (!nodes?.length) {
    return nodes;
  }
  const content = [...nodes];
  while (!keepTrailing && content[content.length - 1]?.type === "hardBreak") {
    content.pop();
  }
  while (!keepLeading && content[0]?.type === "hardBreak") {
    content.shift();
  }
  return content;
}

function linkKey(marks: Mark[] | undefined): string | null {
  const link = marks?.find((mark) => mark.type === "link");
  return link ? JSON.stringify([link.attrs?.href ?? "", link.attrs?.title ?? ""]) : null;
}

function inline(nodes: JSONContent[] | undefined, options: SerializeOptions): string {
  if (!nodes?.length) {
    return "";
  }
  const rendered: string[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    const key = node.type === "text" ? linkKey(node.marks as Mark[] | undefined) : null;
    if (key) {
      let end = index + 1;
      while (
        end < nodes.length &&
        nodes[end].type === "text" &&
        linkKey(nodes[end].marks as Mark[] | undefined) === key
      ) {
        end += 1;
      }
      if (end - index > 1) {
        const link = (node.marks as Mark[]).find((mark) => mark.type === "link")!;
        const href = String(link.attrs?.href ?? "");
        const title = link.attrs?.title ? ` "${String(link.attrs.title)}"` : "";
        const body = nodes
          .slice(index, end)
          .map((part) => {
            const marks = (part.marks as Mark[]).filter((mark) => mark.type !== "link");
            const raw = part.text ?? "";
            const code = marks.some((mark) => mark.type === "code");
            return applyMarks(code ? raw : escapeText(raw), marks);
          })
          .join("");
        rendered.push(`[${body}](${href}${title})`);
        index = end;
        continue;
      }
    }
    if (node.type === "text") {
      const marks = node.marks as Mark[] | undefined;
      const raw = node.text ?? "";
      const code = marks?.some((mark) => mark.type === "code");
      rendered.push(applyMarks(code ? raw : escapeText(raw), marks));
    } else if (node.type === "hardBreak") {
      rendered.push("\n");
    } else if (node.type === "image") {
      rendered.push(image(node, options));
    } else {
      rendered.push(inline(node.content, options));
    }
    index += 1;
  }
  return rendered.join("");
}

function image(node: JSONContent, options: SerializeOptions): string {
  const rawSrc = String(node.attrs?.src ?? "");
  const src = options.resolveImage ? options.resolveImage(rawSrc) : rawSrc;
  const alt = String(node.attrs?.alt ?? "").replace(/[[\]]/g, "");
  const title = node.attrs?.title ? ` "${String(node.attrs.title)}"` : "";
  const ial = node.attrs?.ial ? String(node.attrs.ial) : "";
  return `![${alt}](${src}${title})${ial}`;
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
      const body = (item.content ?? []).reduce((text, child, position) => {
        const rendered = blocks([child], options).join("\n\n");
        if (position === 0) {
          return rendered;
        }
        const hugs = LIST_TYPES.has(child.type ?? "") || Boolean(child.attrs?.joinPrevious);
        return `${text}${hugs ? "\n" : "\n\n"}${rendered}`;
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
  const heading = node.content?.[0]?.content ?? [];
  const divider = Array.from({ length: width }, (_, i) => {
    const align = heading[i]?.attrs?.align;
    if (align === "center") {
      return ":---:";
    }
    return align === "right" ? "---:" : align === "left" ? ":---" : "---";
  });
  return [pad(head), `| ${divider.join(" | ")} |`, ...body.map(pad)].join("\n");
}

function collapsibleBlock(node: JSONContent, options: SerializeOptions): string {
  const summaryNode = node.content?.find((child) => child.type === "collapsibleSummary");
  const contentNode = node.content?.find((child) => child.type === "collapsibleContent");
  const summary = inline(summaryNode?.content, options).trim() || "Details";
  const body = blocks(contentNode?.content, options).join("\n\n");
  const open = node.attrs?.open ? " open" : "";
  return `<details markdown="1"${open}>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

function blocks(nodes: JSONContent[] | undefined, options: SerializeOptions): string[] {
  if (!nodes?.length) {
    return [];
  }
  const out: string[] = [];

  for (const [index, node] of nodes.entries()) {
    const start = out.length;
    switch (node.type) {
      case "paragraph": {
        const after = Boolean(nodes[index + 1]?.attrs?.joinPrevious);
        const before = Boolean(node.attrs?.joinPrevious);
        out.push(inline(withoutEdgeBreaks(node.content, before, after), options));
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6);
        out.push(`${"#".repeat(level)} ${inline(node.content, options)}`);
        break;
      }
      case "blockquote": {
        const inner = blocks(node.content, options).join("\n\n");
        const quoted = inner
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
        const name = node.attrs?.note ? String(node.attrs.note) : "";
        const note = name ? `\n{: ${name === "author" ? ".author" : `.note-${name}`} }` : "";
        out.push(quoted + note);
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
      case "embed":
        out.push(
          embedLiquid(
            String(node.attrs?.platform ?? "youtube"),
            String(node.attrs?.id ?? ""),
            String(node.attrs?.quote ?? "'"),
          ),
        );
        break;
      case "rawBlock":
        out.push((node.content ?? []).map((child) => child.text ?? "").join(""));
        break;
      case "mathBlock": {
        const tex = (node.content ?? []).map((child) => child.text ?? "").join("").trim();
        out.push(`$$\n${tex}\n$$`);
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

    if (node.attrs?.joinPrevious && out.length === start + 1 && start > 0) {
      const piece = out.pop() ?? "";
      if (piece) {
        out[start - 1] = node.attrs?.sameLine
          ? `${out[start - 1]} ${piece}`
          : nextLine(out[start - 1], piece);
      }
    }

    const ial = node.attrs?.blockIal ? String(node.attrs.blockIal) : "";
    if (ial && out.length) {
      out[out.length - 1] = nextLine(out[out.length - 1], ial);
    }
  }

  return out.filter((block) => block !== undefined);
}

export function docToMarkdown(doc: JSONContent, options: SerializeOptions = {}): string {
  return blocks(doc.content, options)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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

const YAML_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}$|^\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|[ \t]+)\d{1,2}:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d{1,2}(?::\d{2})?))?$/;

const YAML_NUMBER = /^[-+]?(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][-+]?\d+)?$|^[-+]?0[xob][0-9a-fA-F_]+$|^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/;

const YAML_BOOL_OR_NULL = /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;

function yamlString(value: string): string {
  const text = value.replace(/\s*\n\s*/g, " ").trim();
  const plainIsSafe =
    text !== "" &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
    !/:\s|\s#/.test(text) &&
    !/[\t\n]/.test(text) &&
    !text.endsWith(":") &&
    !YAML_TIMESTAMP.test(text) &&
    !YAML_NUMBER.test(text) &&
    !YAML_BOOL_OR_NULL.test(text);
  if (text === "") {
    return "''";
  }
  return plainIsSafe ? text : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(key: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`${key}: []`];
  }
  return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
}

export function buildFrontMatter(meta: PostMeta): string {
  const lines = ["---", `title: ${yamlString(meta.title)}`];
  if (meta.description.trim()) {
    lines.push(`description: ${yamlString(meta.description)}`);
  }
  lines.push(`author: ${yamlString(meta.author)}`, `date: ${yamlString(meta.date)}`);
  lines.push(...yamlList("categories", meta.categories));
  lines.push(...yamlList("tags", meta.tags));
  lines.push(
    `pin: ${Boolean(meta.pin)}`,
    `toc: ${Boolean(meta.toc)}`,
    `math: ${Boolean(meta.math)}`,
    `mermaid: ${Boolean(meta.mermaid)}`,
    `chart: ${Boolean(meta.chart)}`,
  );
  if (meta.cover?.path) {
    lines.push("image:", `  path: ${yamlString(meta.cover.path)}`);
    if (meta.cover.alt.trim()) {
      lines.push(`  alt: ${yamlString(meta.cover.alt)}`);
    }
    if (meta.cover.lqip?.trim()) {
      lines.push(`  lqip: ${yamlString(meta.cover.lqip)}`);
    }
  }
  if (meta.extra?.length) {
    lines.push(...meta.extra);
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildPostFile(meta: PostMeta, doc: JSONContent, options: SerializeOptions = {}): string {
  return `${buildFrontMatter(meta)}\n${docToMarkdown(doc, options)}\n`;
}
