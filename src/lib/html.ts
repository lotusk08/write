import type { PostMeta } from "../../shared/types.ts";
import { isLocalSrc, localId, imageStore } from "./db.ts";
import { bytesToBase64 } from "../../shared/base64.ts";

async function inlineImages(root: Document): Promise<void> {
  const images = [...root.querySelectorAll("img")].filter((img) =>
    isLocalSrc(img.getAttribute("src")),
  );
  await Promise.all(
    images.map(async (img) => {
      const stored = await imageStore.get(localId(img.getAttribute("src") ?? ""));
      if (!stored) {
        img.removeAttribute("src");
        return;
      }
      const bytes = new Uint8Array(await stored.blob.arrayBuffer());
      img.setAttribute("src", `data:${stored.type};base64,${bytesToBase64(bytes)}`);
    }),
  );
}

function toDetails(root: Document): void {
  for (const node of [...root.querySelectorAll("[data-collapsible]")]) {
    const details = root.createElement("details");
    if (node.getAttribute("data-open") !== "false") {
      details.setAttribute("open", "");
    }
    const summary = root.createElement("summary");
    summary.innerHTML = node.querySelector("[data-collapsible-summary]")?.innerHTML ?? "Details";
    details.append(summary);
    const body = node.querySelector("[data-collapsible-content]");
    if (body) {
      details.insertAdjacentHTML("beforeend", body.innerHTML);
    }
    node.replaceWith(details);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[char]};`);
}

export async function buildHtmlDocument(editorHtml: string, meta: PostMeta): Promise<string> {
  const parsed = new DOMParser().parseFromString(`<body>${editorHtml}</body>`, "text/html");
  toDetails(parsed);
  await inlineImages(parsed);

  const title = escapeHtml(meta.title || "Untitled");
  const description = meta.description ? `<p class="lede">${escapeHtml(meta.description)}</p>` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem;
    font: 18px/1.75 ui-serif, Georgia, "Times New Roman", serif; }
  h1 { font-size: 2rem; line-height: 1.2; }
  .lede { color: #666; font-style: italic; }
  img { max-width: 100%; border-radius: 8px; }
  pre { padding: 1rem; border-radius: 8px; background: rgb(128 128 128 / 12%); overflow-x: auto; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85em; }
  blockquote { padding-left: 1rem; border-left: 3px solid rgb(128 128 128 / 40%); margin-left: 0; color: #666; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.4rem 0.6rem; border: 1px solid rgb(128 128 128 / 35%); }
  summary { cursor: pointer; font-weight: 600; }
  sup[data-footnote-ref] { font-size: 0.75em; }
  [data-footnote] { font-size: 0.9em; color: #666; }
  [data-footnote]::before { content: "^" attr(data-footnote) " "; float: left; margin-right: 0.5em; }
</style>
</head>
<body>
<h1>${title}</h1>
${description}
${parsed.body.innerHTML}
</body>
</html>
`;
}
