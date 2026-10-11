import { describe, expect, it } from "vitest";
import { localIdsIn, type Draft } from "./db.ts";

const draft = (doc: object, cover?: string) =>
  ({ id: "d", doc, meta: { title: "", date: "", tags: [], categories: [], cover: cover ? { path: cover, alt: "" } : null } }) as unknown as Draft;

describe("localIdsIn", () => {
  it("finds every stored photo a draft points at, body, gallery and cover", () => {
    const image = (src: string) => ({ type: "image", attrs: { src } });
    const doc = {
      type: "doc",
      content: [image("local:a-1"), { type: "gallery", content: [image("local:b-2"), image("/assets/img/post/x.webp")] }],
    };
    expect(localIdsIn([draft(doc, "local:c-3"), draft({ type: "doc", content: [image("local:a-1")] })])).toEqual(
      new Set(["a-1", "b-2", "c-3"]),
    );
  });
});
