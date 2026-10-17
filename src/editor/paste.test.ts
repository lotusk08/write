// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { htmlToDoc } from "./bridge.ts";
import { pasteClipboard, pastedHtml } from "./paste.ts";
import { docToMarkdown } from "../lib/markdown.ts";

const DOCS_SPAN = "font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre-wrap;";
const DOCS =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c">' +
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="${DOCS_SPAN}font-weight:400;font-style:normal;">Plain first para</span></p><br>` +
  `<p dir="ltr" style="line-height:1.38;"><span style="${DOCS_SPAN}font-weight:700;font-style:normal;">Bold then </span>` +
  `<span style="${DOCS_SPAN}font-weight:700;font-style:italic;">both</span><span style="${DOCS_SPAN}font-weight:400;font-style:italic;"> italic</span></p>` +
  `<h2 dir="ltr" style="line-height:1.38;"><span style="font-size:16pt;font-family:Arial;font-weight:400;">Heading</span></h2>` +
  `<p dir="ltr"><a href="https://example.com/a" style="text-decoration:none;"><span style="${DOCS_SPAN}color:#1155cc;font-weight:400;text-decoration:underline;-webkit-text-decoration-skip:none;">link</span></a></p>` +
  `<ul style="margin-top:0;"><li dir="ltr" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="${DOCS_SPAN}">item one</span></p></li>` +
  `<li dir="ltr" style="list-style-type:disc;"><p dir="ltr" role="presentation"><span style="${DOCS_SPAN}">item two</span></p></li></ul>` +
  '</b><br class="Apple-interchange-newline">';

const WORD =
  '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style></head><body lang=EN-US><!--StartFragment-->' +
  "<p class=MsoNormal><b>Bold</b> and <i>italic</i><o:p></o:p></p>" +
  "<p class=MsoListParagraphCxSpFirst style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Item one<o:p></o:p></p>" +
  "<p class=MsoListParagraphCxSpLast style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span>&nbsp;</span></span></span><![endif]>Item two<o:p></o:p></p>" +
  "<p class=MsoNormal>Between</p>" +
  "<p class=MsoListParagraphCxSpFirst style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;</span></span><![endif]>First<o:p></o:p></p>" +
  "<p class=MsoListParagraphCxSpLast style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span><![endif]>Second<o:p></o:p></p>" +
  "<!--EndFragment--></body></html>";

const WEB =
  '<h1 style="font-size:40px;color:#333">Title</h1>' +
  '<p style="color:red;font-family:Georgia">Text with <span style="font-size:20px;color:blue">big</span> and <strong>bold</strong> ' +
  '<a href="javascript:alert(1)">bad</a> <a href="/rel">rel</a></p>' +
  '<figure><img src="https://x.com/a.jpg" alt=""><figcaption>Cap</figcaption></figure><script>alert(1)</script>';

const markdown = (html: string | null) => docToMarkdown(htmlToDoc(html ?? ""));

describe("paste", () => {
  it("reads a Google Docs paste as its paragraphs, heading, marks, link and list", () => {
    expect(markdown(pastedHtml(DOCS, ""))).toBe(
      "Plain first para\n\n**Bold then *both*** *italic*\n\n## Heading\n\n[link](https://example.com/a)\n\n- item one\n- item two",
    );
  });

  it("turns Word's list paragraphs into lists and drops its markers", () => {
    expect(markdown(pastedHtml(WORD, ""))).toBe("**Bold** and *italic*\n\n- Item one\n- Item two\n\nBetween\n\n1. First\n2. Second");
  });

  it("keeps a web page's structure but none of its styles, scripts or unsafe links", () => {
    const html = pastedHtml(WEB, "") ?? "";
    expect(html).not.toMatch(/style=|script|javascript:/);
    expect(markdown(html)).toBe("# Title\n\nText with big and **bold** bad [rel](/rel)\n\n![](https://x.com/a.jpg \"Cap\")");
  });

  it("drops a highlight, which has no tool to take it off again", () => {
    expect(markdown(pastedHtml("<p>a <mark>found</mark> c</p>", "a found c"))).toBe("a found c");
    expect(markdown(pastedHtml("<p>a <b><mark>found</mark></b> c</p>", "a found c"))).toBe("a **found** c");
  });

  it("parses plain text that is clearly Markdown", () => {
    expect(markdown(pastedHtml("", "## Title\r\n- a\r\n**bold** text"))).toBe("## Title\n- a\n**bold** text");
  });

  it("pastes other plain text as paragraphs and line breaks, Windows line ends folded", () => {
    expect(markdown(pastedHtml("", "one\r\ntwo\r\n\r\nthree"))).toBe("one\ntwo\n\nthree");
    expect(pastedHtml("", "just words")).toBe("just words");
  });

  it("treats a styled-only paste, as from a code editor, as its plain text", () => {
    const code = '<div style="color:#d4d4d4;font-family:Menlo"><span style="color:#569cd6">## Notes</span></div>';
    expect(markdown(pastedHtml(code, "## Notes"))).toBe("## Notes");
  });

  it("makes an embed of a player link pasted alone, and a paragraph of anything else", () => {
    document.body.innerHTML = '<div contenteditable="true"><p><br></p></div>';
    const root = document.body.firstElementChild as HTMLElement;
    const paste = (text: string) => {
      const range = document.createRange();
      range.setStart(root.querySelector("p")!, 0);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      const data = new DataTransfer();
      data.setData("text/plain", text);
      const event = new ClipboardEvent("paste", { clipboardData: data, cancelable: true });
      Object.defineProperty(event, "currentTarget", { value: root });
      return pasteClipboard(event);
    };
    expect(paste("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(root.querySelector("[data-embed]")?.getAttribute("data-id")).toBe("dQw4w9WgXcQ");
    root.innerHTML = "<p><br></p>";
    document.execCommand = () => true;
    paste("dQw4w9WgXcQ");
    expect(root.querySelector("[data-embed]")).toBeNull();
  });

  it("pastes blocks where the caret sits on the editor itself, as after a trailing photo", () => {
    document.body.innerHTML = '<div contenteditable="true"><p>Before</p><figure><img src="/a.webp" alt=""></figure></div>';
    const root = document.body.firstElementChild as HTMLElement;
    const range = document.createRange();
    range.setStart(root, root.childNodes.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const data = new DataTransfer();
    data.setData("text/html", "<p>One</p><p>Two</p>");
    data.setData("text/plain", "One\n\nTwo");
    const event = new ClipboardEvent("paste", { clipboardData: data, cancelable: true });
    Object.defineProperty(event, "currentTarget", { value: root });
    expect(pasteClipboard(event)).toBe(true);
    expect([...root.children].map((node) => `${node.nodeName}:${node.textContent}`)).toEqual(["P:Before", "FIGURE:", "P:One", "P:Two"]);
  });
});
