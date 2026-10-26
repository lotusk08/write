export type Teardown = () => void;

const noop: Teardown = () => {};

function fail(target: HTMLElement, error: unknown): Teardown {
  target.textContent = error instanceof Error ? error.message : String(error);
  target.dataset.state = "error";
  return noop;
}

/** Loads a module once, but forgets a failed load so the next preview tries again. */
export function retrying<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    }));
}

const loadPele = retrying(() => import("pele/lazy"));
const LABEL_PX = 16;
let drawn = 0;

export async function renderDiagram(source: string, target: HTMLElement, current: () => boolean): Promise<Teardown> {
  try {
    const { renderAsync } = await loadPele();
    const fontFamily = getComputedStyle(target).getPropertyValue("--pele-font").trim() || undefined;
    const { svg, width } = await renderAsync(source, { fontFamily, fontSize: LABEL_PX, idPrefix: `preview-${++drawn}` });
    if (!current()) {
      return noop;
    }
    target.innerHTML = svg;
    target.style.setProperty("--w", `${width / LABEL_PX}em`);
    delete target.dataset.state;
    return () => {
      target.innerHTML = "";
    };
  } catch (error) {
    return current() ? fail(target, error) : noop;
  }
}

const loadChart = retrying(() => import("chart.js/auto").then((module) => module.default));

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
