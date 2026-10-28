import { retrying } from "../editor/render.ts";

type Reader = typeof import("./import.ts");

let loaded: Reader | null = null;

/**
 * The Markdown reader — markdown-it with the blog's plugins and rules, and the front matter — loaded apart from the
 * app, which starts without it: it comes in once the app is idle, or sooner if a post is opened, the source view
 * shown or Markdown pasted first.
 */
export const loadReader = retrying(() => import("./import.ts").then((reader) => (loaded = reader)));

/** The reader once it has loaded, for what cannot wait for it; null before. */
export function loadedReader(): Reader | null {
  return loaded;
}

/** Loads the reader when the browser is next idle, so it is there before it is needed. */
export function preloadReader(): void {
  const load = () => void loadReader().catch(() => {});
  // Not every browser has an idle callback.
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(load, { timeout: 3000 });
  } else {
    setTimeout(load, 1000);
  }
}
