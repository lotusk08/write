/**
 * Live previews for the three block types the blog renders with a JavaScript
 * library rather than with Markdown: Mermaid diagrams, Chart.js charts and
 * TeX. Each library is imported on first use, so a post without them never
 * pays for them.
 *
 * Every renderer paints into the element it is given and returns a teardown
 * for whatever it left behind.
 */

export type Teardown = () => void;

const noop: Teardown = () => {};

function fail(target: HTMLElement, error: unknown): Teardown {
  target.textContent = error instanceof Error ? error.message : String(error);
  target.dataset.state = "error";
  return noop;
}

let mermaidLoader: Promise<typeof import("mermaid").default> | null = null;

async function loadMermaid() {
  mermaidLoader ??= import("mermaid").then((module) => module.default);
  return mermaidLoader;
}

export async function renderMermaid(
  source: string,
  target: HTMLElement,
  dark: boolean,
  id: string,
): Promise<Teardown> {
  try {
    const mermaid = await loadMermaid();
    // Re-initialised per render so the diagram follows the app's theme.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
    const { svg } = await mermaid.render(id, source);
    target.innerHTML = svg;
    delete target.dataset.state;
    return () => {
      target.innerHTML = "";
    };
  } catch (error) {
    // A half-typed diagram leaves its error element behind on the body.
    document.querySelector(`#d${id}`)?.remove();
    return fail(target, error);
  }
}

let chartLoader: Promise<typeof import("chart.js/auto").default> | null = null;

async function loadChart() {
  chartLoader ??= import("chart.js/auto").then((module) => module.default);
  return chartLoader;
}

export async function renderChart(source: string, target: HTMLElement, dark: boolean): Promise<Teardown> {
  try {
    const config = JSON.parse(source) as Record<string, unknown>;
    const Chart = await loadChart();
    target.innerHTML = "";
    delete target.dataset.state;
    // Chart.js measures its own box, so the preview gets a fixed one rather
    // than a pie chart as tall as the editor is wide.
    const frame = document.createElement("div");
    frame.className = "chart-frame";
    const canvas = document.createElement("canvas");
    frame.append(canvas);
    target.append(frame);
    Chart.defaults.color = dark ? "#a3a3a6" : "#5c5c5e";
    Chart.defaults.borderColor = dark ? "#272727" : "#e6e6e8";
    const chart = new Chart(canvas, {
      ...config,
      options: { maintainAspectRatio: false, ...(config.options as object), responsive: true },
    } as never);
    return () => {
      chart.destroy();
      frame.remove();
    };
  } catch (error) {
    return fail(target, error);
  }
}

let katexLoader: Promise<typeof import("katex").default> | null = null;

async function loadKatex() {
  katexLoader ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([module]) => module.default,
  );
  return katexLoader;
}

/**
 * The blog typesets with MathJax, not KaTeX, so this is a preview of the same
 * TeX rather than the exact glyphs the published page will show.
 */
export async function renderMath(source: string, target: HTMLElement): Promise<Teardown> {
  try {
    const katex = await loadKatex();
    katex.render(source, target, { displayMode: true, throwOnError: false, output: "html" });
    delete target.dataset.state;
    return () => {
      target.innerHTML = "";
    };
  } catch (error) {
    return fail(target, error);
  }
}
