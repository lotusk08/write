// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderDiagram } from "./render.ts";

describe("renderDiagram", () => {
  it("draws a mermaid fence as an SVG and clears it on teardown", async () => {
    const target = document.createElement("div");
    target.dataset.state = "error";
    const teardown = await renderDiagram("flowchart LR\n  Write --> Publish", target, () => true);
    expect(target.querySelector("svg.pele")).not.toBeNull();
    expect(target.textContent).toContain("Publish");
    expect(target.dataset.state).toBeUndefined();
    teardown();
    expect(target.innerHTML).toBe("");
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
