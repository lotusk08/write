import { retrying } from "../editor/render.ts";

type Reader = typeof import("./import.ts");

let loaded: Reader | null = null;

export const loadReader = retrying(() => import("./import.ts").then((reader) => (loaded = reader)));

export function loadedReader(): Reader | null {
  return loaded;
}

export function preloadReader(): void {
  const load = () => void loadReader().catch(() => {});
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1000);
  }
}
