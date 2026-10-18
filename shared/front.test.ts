import { describe, expect, it } from "vitest";
import { frontMatter, splitFront } from "./front.ts";

describe("splitFront", () => {
  it("cuts a file into pieces that put it back together byte for byte", () => {
    for (const text of ["---\ntitle: A\n---\nBody\n", "\ufeff---\r\ntitle: A\r\n---  \r\nBody", "---\n---\n", "---  \nx: 1\n---"]) {
      const front = splitFront(text);
      expect(front && front.open + front.body + front.close + front.rest).toBe(text);
    }
    expect(splitFront("\ufeff---\r\ntitle: A\r\npin: 2\r\n---\r\nBody")).toEqual({
      open: "\ufeff---\r\n",
      body: "title: A\r\npin: 2\r\n",
      close: "---\r\n",
      rest: "Body",
    });
  });

  it("finds none without an opening line at the very start, or without a closing one", () => {
    for (const text of ["Body\n---\ntitle: A\n---\n", " ---\ntitle: A\n---\n", "\ufeff\ufeff---\ntitle: A\n---\n", "---\ntitle: A\n", "---\ntitle: A\n----\n"]) {
      expect(splitFront(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe("frontMatter", () => {
  it("reads the YAML between, without its last line end, and what follows", () => {
    expect(frontMatter("\ufeff---\r\ntitle: A\r\ndate: 2026-10-11\r\n---  \r\nBody\r\n")).toEqual({ yaml: "title: A\r\ndate: 2026-10-11", rest: "Body\r\n" });
    expect(frontMatter("---\n\n---\n")).toEqual({ yaml: "", rest: "" });
  });

  it("takes none where splitFront still finds some", () => {
    for (const text of ["---\n---\nBody\n", "--- \ntitle: A\n---\n", "---\t\ntitle: A\n---\n"]) {
      expect(splitFront(text), JSON.stringify(text)).not.toBeNull();
      expect(frontMatter(text), JSON.stringify(text)).toBeNull();
    }
  });
});
