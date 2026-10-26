// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderDiagram, retrying } from "./render.ts";

describe("renderDiagram", () => {
  it("draws a mermaid fence as an SVG and clears it on teardown", async () => {
    const target = document.createElement("div");
    target.dataset.state = "error";
    const teardown = await renderDiagram("flowchart LR\n  Write --> Publish", target, () => true);
    expect(target.querySelector("svg.pele")).not.toBeNull();
    expect(target.textContent).toContain("Publish");
    expect(target.dataset.state).toBeUndefined();
    expect(target.style.getPropertyValue("--w")).toMatch(/^\d+(\.\d+)?px$/);
    teardown();
    expect(target.innerHTML).toBe("");
  });

  it("gives every preview its own SVG ids", async () => {
    const source = "flowchart LR\n  accTitle: Publishing\n  Write --> Publish";
    const first = document.createElement("div");
    const second = document.createElement("div");
    await renderDiagram(source, first, () => true);
    await renderDiagram(source, second, () => true);
    const ids = [first, second].map((target) => target.querySelector("[id]")?.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("shows the parse error in place of the diagram", async () => {
    const target = document.createElement("div");
    await renderDiagram("flowchart LR\n  A -->", target, () => true);
    expect(target.dataset.state).toBe("error");
    expect(target.querySelector("svg")).toBeNull();
    expect(target.textContent).toContain("Parse error on line");
  });

  it("leaves the preview alone when a newer render has started", async () => {
    const target = document.createElement("div");
    target.innerHTML = "<p>newer</p>";
    const teardown = await renderDiagram("flowchart LR\n  A --> B", target, () => false);
    await renderDiagram("flowchart LR\n  A -->", target, () => false);
    teardown();
    expect(target.innerHTML).toBe("<p>newer</p>");
    expect(target.dataset.state).toBeUndefined();
  });
});

describe("retrying", () => {
  it("keeps a loaded module but tries a failed load again", async () => {
    let calls = 0;
    const load = retrying(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("offline");
      }
      return calls;
    });
    await expect(load()).rejects.toThrow("offline");
    await expect(load()).resolves.toBe(2);
    await expect(load()).resolves.toBe(2);
    expect(calls).toBe(2);
  });
});
