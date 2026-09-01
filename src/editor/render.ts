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
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
    const { svg } = await mermaid.render(id, source);
    target.innerHTML = svg;
    delete target.dataset.state;
    return () => {
      target.innerHTML = "";
    };
  } catch (error) {
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
