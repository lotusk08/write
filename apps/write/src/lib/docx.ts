import type { JSONContent } from "@tiptap/core";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { PostMeta } from "../../shared/types.ts";
import { isLocalSrc, imageStore, localId } from "./db.ts";

type Mark = { type: string; attrs?: Record<string, unknown> };
type DocxImageType = "png" | "jpg" | "gif" | "bmp";

const MAX_IMAGE_WIDTH = 600;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface PreparedImage {
  data: Uint8Array;
  type: DocxImageType;
  width: number;
  height: number;
}

function docxImageType(mime: string): DocxImageType | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/bmp") return "bmp";
  return null;
}

/** Word only accepts a few formats, so anything else (webp, avif…) is re-encoded as PNG. */
async function prepareImage(blob: Blob): Promise<PreparedImage | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    let type = docxImageType(blob.type);
    let source = blob;
    if (!type) {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }
      context.drawImage(bitmap, 0, 0);
      source = await canvas.convertToBlob({ type: "image/png" });
      type = "png";
    }
    bitmap.close();

    return { data: new Uint8Array(await source.arrayBuffer()), type, width, height };
  } catch {
    return null;
  }
}

async function loadImage(src: string): Promise<PreparedImage | null> {
  if (isLocalSrc(src)) {
    const stored = await imageStore.get(localId(src));
    return stored ? prepareImage(stored.blob) : null;
  }
  if (/^https?:/.test(src)) {
    try {
      const response = await fetch(src);
      if (!response.ok) {
        return null;
      }
      return prepareImage(await response.blob());
    } catch {
      // Cross-origin images without CORS headers simply cannot be embedded.
      return null;
    }
  }
  return null;
}

/** Collects every image in the document up front; docx needs bytes, not URLs. */
async function collectImages(doc: JSONContent): Promise<Map<string, PreparedImage>> {
  const srcs = new Set<string>();
  const walk = (node: JSONContent) => {
    if (node.type === "image" && node.attrs?.src) {
      srcs.add(String(node.attrs.src));
    }
    node.content?.forEach(walk);
  };
  walk(doc);

  const entries = await Promise.all(
    [...srcs].map(async (src) => [src, await loadImage(src)] as const),
  );
  return new Map(entries.filter((entry): entry is [string, PreparedImage] => entry[1] !== null));
}

function runs(nodes: JSONContent[] | undefined, images: Map<string, PreparedImage>): (TextRun | ImageRun | ExternalHyperlink)[] {
  if (!nodes?.length) {
    return [];
  }

  const out: (TextRun | ImageRun | ExternalHyperlink)[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    if (node.type === "image") {
      const image = images.get(String(node.attrs?.src ?? ""));
      if (image) {
        out.push(
          new ImageRun({
            data: image.data,
            type: image.type,
            transformation: { width: image.width, height: image.height },
          }),
        );
      } else {
        out.push(new TextRun({ text: `[image: ${String(node.attrs?.alt || node.attrs?.src || "")}]`, italics: true }));
      }
      continue;
    }
    if (node.type !== "text") {
      out.push(...runs(node.content, images));
      continue;
    }

    const marks = (node.marks ?? []) as Mark[];
    const isCode = marks.some((mark) => mark.type === "code");
    const run = new TextRun({
      text: node.text ?? "",
      bold: marks.some((mark) => mark.type === "bold"),
      italics: marks.some((mark) => mark.type === "italic"),
      strike: marks.some((mark) => mark.type === "strike"),
      underline: marks.some((mark) => mark.type === "underline") ? {} : undefined,
      font: isCode ? "Consolas" : undefined,
      shading: marks.some((mark) => mark.type === "highlight")
        ? { type: ShadingType.CLEAR, fill: "FFF3A3" }
        : undefined,
    });

    const link = marks.find((mark) => mark.type === "link");
    if (link) {
      out.push(new ExternalHyperlink({ children: [run], link: String(link.attrs?.href ?? "") }));
    } else {
      out.push(run);
    }
  }
  return out;
}

interface BlockContext {
  images: Map<string, PreparedImage>;
  indent?: number;
  quote?: boolean;
}

function blocks(nodes: JSONContent[] | undefined, context: BlockContext): (Paragraph | Table)[] {
  if (!nodes?.length) {
    return [];
  }

  const out: (Paragraph | Table)[] = [];
  const indent = context.indent ? { left: context.indent * 360 } : undefined;

  for (const node of nodes) {
    switch (node.type) {
      case "paragraph":
        out.push(
          new Paragraph({
            children: runs(node.content, context.images),
            indent,
            spacing: { after: 160 },
            border: context.quote
              ? { left: { style: BorderStyle.SINGLE, size: 12, space: 12, color: "BBBBBB" } }
              : undefined,
          }),
        );
        break;
      case "heading":
        out.push(
          new Paragraph({
            children: runs(node.content, context.images),
            heading: HEADINGS[Math.min(Math.max(Number(node.attrs?.level ?? 2), 1), 6) - 1],
            spacing: { before: 280, after: 140 },
          }),
        );
        break;
      case "blockquote":
        out.push(...blocks(node.content, { ...context, quote: true, indent: (context.indent ?? 0) + 1 }));
        break;
      case "bulletList":
      case "taskList":
      case "orderedList": {
        const ordered = node.type === "orderedList";
        const level = context.indent ?? 0;
        for (const item of node.content ?? []) {
          const checkbox = item.type === "taskItem" ? (item.attrs?.checked ? "☑ " : "☐ ") : "";
          const [first, ...rest] = item.content ?? [];
          out.push(
            new Paragraph({
              children: [
                ...(checkbox ? [new TextRun({ text: checkbox })] : []),
                ...runs(first?.content, context.images),
              ],
              ...(ordered
                ? { numbering: { reference: "write-ordered", level } }
                : { bullet: { level } }),
              spacing: { after: 80 },
            }),
          );
          out.push(...blocks(rest, { ...context, indent: level + 1 }));
        }
        break;
      }
      case "codeBlock":
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: (node.content ?? []).map((child) => child.text ?? "").join(""),
                font: "Consolas",
                size: 20,
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F4F4F5" },
            spacing: { after: 160 },
            indent,
          }),
        );
        break;
      case "horizontalRule":
        out.push(
          new Paragraph({
            text: "",
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 8, color: "CCCCCC" } },
            spacing: { after: 200 },
          }),
        );
        break;
      case "image":
        out.push(new Paragraph({ children: runs([node], context.images), alignment: AlignmentType.CENTER, spacing: { after: 160 } }));
        break;
      case "collapsible": {
        const summary = node.content?.find((child) => child.type === "collapsibleSummary");
        const body = node.content?.find((child) => child.type === "collapsibleContent");
        out.push(
          new Paragraph({
            children: runs(summary?.content, context.images),
            heading: HeadingLevel.HEADING_4,
            spacing: { before: 200, after: 100 },
          }),
        );
        out.push(...blocks(body?.content, { ...context, indent: (context.indent ?? 0) + 1 }));
        break;
      }
      case "table": {
        const rows = (node.content ?? []).map(
          (row) =>
            new TableRow({
              children: (row.content ?? []).map(
                (cell) =>
                  new TableCell({
                    children: blocks(cell.content, context).filter(
                      (child): child is Paragraph => child instanceof Paragraph,
                    ),
                    shading:
                      cell.type === "tableHeader"
                        ? { type: ShadingType.CLEAR, fill: "F4F4F5" }
                        : undefined,
                  }),
              ),
            }),
        );
        if (rows.length) {
          out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
          out.push(new Paragraph({ text: "", spacing: { after: 160 } }));
        }
        break;
      }
      default:
        out.push(...blocks(node.content, context));
        break;
    }
  }

  return out;
}

/** Renders the document (plus a title block) as a real .docx file. */
export async function docToDocxBlob(doc: JSONContent, meta: PostMeta): Promise<Blob> {
  const images = await collectImages(doc);

  const header: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: meta.title || "Untitled", bold: true })],
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
    }),
  ];
  if (meta.description) {
    header.push(
      new Paragraph({
        children: [new TextRun({ text: meta.description, italics: true, color: "666666" })],
        spacing: { after: 240 },
      }),
    );
  }

  const document = new Document({
    creator: meta.author || "write",
    title: meta.title || "Untitled",
    description: meta.description,
    numbering: {
      config: [
        {
          reference: "write-ordered",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: "Georgia", size: 24 }, paragraph: { spacing: { line: 320 } } },
      },
    },
    sections: [{ children: [...header, ...blocks(doc.content, { images })] }],
  });

  return Packer.toBlob(document);
}
