export type Teardown = () => void;

const noop: Teardown = () => {};

function fail(target: HTMLElement, error: unknown): Teardown {
  target.textContent = error instanceof Error ? error.message : String(error);
  target.dataset.state = "error";
  return noop;
}

let peleLoader: Promise<typeof import("pele/lazy")> | null = null;

async function loadPele() {
  peleLoader ??= import("pele/lazy");
  return peleLoader;
}

export async function renderDiagram(source: string, target: HTMLElement, current: () => boolean): Promise<Teardown> {
  try {
    const { renderAsync } = await loadPele();
    const { svg } = await renderAsync(source);
    if (!current()) {
      return noop;
    }
    target.innerHTML = svg;
    delete target.dataset.state;
    return () => {
      target.innerHTML = "";
    };
  } catch (error) {
    return current() ? fail(target, error) : noop;
  }
}

let chartLoader: Promise<typeof import("chart.js/auto").default> | null = null;

async function loadChart() {
  chartLoader ??= import("chart.js/auto").then((module) => module.default);
  return chartLoader;
}

export async function renderChart(source: string, target: HTMLElement): Promise<Teardown> {
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
    const tokens = getComputedStyle(target);
    Chart.defaults.color = tokens.getPropertyValue("--muted").trim();
    Chart.defaults.borderColor = tokens.getPropertyValue("--border").trim();
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
