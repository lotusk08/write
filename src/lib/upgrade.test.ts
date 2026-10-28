import { describe, expect, it } from "vitest";
import type { JSONContent } from "../editor/doc.ts";
import { currentDoc, currentSource } from "./draft.ts";
import { upgradeSyntax } from "./upgrade.ts";

describe("kramdown's older forms", () => {
  it.each([
    ["a callout under its quote", "> said\n{: .info}", "> [!info]\n> said"],
    ["a callout under a quote's lazy line, the next paragraph kept apart", "> said\nlazily\n{: .warn}\nnext", "> [!warn]\n> said\nlazily\n\nnext"],
    ["a callout in a list item", "- item\n\n  > quote\n  {: .tip}\n- next", "- item\n\n  > [!tip]\n  > quote\n\n- next"],
    ["a class that names no callout", "> said\n{: .on-quote #keyed}", "> said\n{.on-quote #keyed}"],
    ["a callout's class under a rule, as the rule's", "> said\n\n---\n{: .info}", "> said\n\n---\n{.info}"],
    ["inline lists", '`a.ts`{: .path} and [In](/in){: icon="linkedin"}', '`a.ts`{.path} and [In](/in){icon="linkedin"}'],
  ])("reads %s as the blog does now", (_name, before, after) => {
    expect(upgradeSyntax(before)).toBe(after);
  });

  it.each([
    ["in a fence", "```md\n> said\n{: .info}\n```"],
    ["in indented code", "Para\n\n    > q\n    {: .info}\n    code {: .x}"],
    ["in an HTML block", "<div>\n> x\n{: .info}\n</div>"],
    ["in a code span", "`{: .path}`"],
    ["escaped", "\\{: .path}"],
    ["holding more than attributes", "{:toc} and {: a, b}"],
  ])("leaves a list %s as written", (_name, markdown) => {
    expect(upgradeSyntax(markdown)).toBe(markdown);
  });

  it("writes a draft kept with them in the forms the blog reads now", () => {
    const doc = currentDoc({
      type: "doc",
      content: [
        { type: "blockquote", attrs: { blockIal: "{: .poem }" }, content: [] },
        { type: "image", attrs: { src: "/a.webp", ial: "{: .light}" } },
        // As the app before kept them: the list after a link or a mark as text, as raw text once it held it so.
        {
          type: "paragraph",
          content: [
            { type: "text", text: "{: .first} " },
            { type: "text", text: "In", marks: [{ type: "link", attrs: { href: "/in" } }] },
            { type: "text", text: '{: icon="x"} and ' },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
            { type: "text", text: "{: .y}" },
            { type: "text", text: "{: .z}", marks: [{ type: "rawInline" }] },
          ],
        },
      ],
    });
    expect(doc.content?.[0].attrs?.blockIal).toBe("{.poem}");
    expect(doc.content?.[1].attrs?.ial).toBe("{.light}");
    expect(doc.content?.[2].content).toEqual([
      { type: "text", text: "{: .first} " },
      { type: "text", text: "In", marks: [{ type: "link", attrs: { href: "/in" } }] },
      { type: "text", text: '{icon="x"}', marks: [{ type: "rawInline" }] },
      { type: "text", text: " and " },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
      { type: "text", text: "{.y}", marks: [{ type: "rawInline" }] },
      { type: "text", text: "{.z}", marks: [{ type: "rawInline" }] },
    ]);
    const current: JSONContent = { type: "doc", content: [{ type: "paragraph", attrs: { blockIal: "{.x}" }, content: [{ type: "text", text: "a" }] }] };
    expect(currentDoc(current)).toBe(current);
  });

  it("drops the source view's text typed in them, so the view shows what is published", () => {
    expect(currentSource({ text: "> q\n{: .info}\n", front: "", body: "" })).toBeUndefined();
    const typed = { text: "> [!info]\n> q\n", front: "", body: "" };
    expect(currentSource(typed)).toBe(typed);
  });
});
