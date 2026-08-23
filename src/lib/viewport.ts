import { useEffect, useState } from "react";

/** Phone layout — kept in step with the same breakpoint in `styles.css`. */
export const PHONE_QUERY = "(width <= 640px)";

/** An inset this deep is a keyboard rather than a browser chrome nudge. */
const KEYBOARD_INSET = 120;

export interface ViewportBand {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The band of the window that is actually on screen, in client coordinates —
 * on a phone, what the keyboard has left of it.
 *
 * `position: fixed` and `getBoundingClientRect()` are both measured from the
 * layout viewport, which the keyboard does not resize; the visual viewport is
 * the part of it still visible, and its offset is what separates the two. Menus
 * are placed against this rather than against `innerHeight`, which on a phone
 * counts the screen behind the keyboard.
 */
export function viewportBand(): ViewportBand {
  const view = window.visualViewport;
  const top = view?.offsetTop ?? 0;
  const left = view?.offsetLeft ?? 0;
  const width = view?.width ?? window.innerWidth;
  const height = view?.height ?? window.innerHeight;
  return { top, left, width, height, right: left + width, bottom: top + height };
}

/**
 * Pins the app to that band, as `--app-top`, `--app-height` and `--app-bottom`.
 *
 * iOS does not resize the page for the keyboard: it scrolls the window under
 * it, which leaves the toolbar — the last row of a full-height layout — below
 * the fold and out of reach. Sizing the shell to the visible band puts it back,
 * and gives anything else pinned to the window an edge to sit above.
 */
export function usePinnedViewport(): void {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) {
      return;
    }
    const root = document.documentElement;
    const sync = () => {
      // Pinch-zoom shrinks the visual viewport too, and following it there
      // would shrink the app to the magnified area. Only an inset the size of
      // a keyboard, at rest scale, is worth reacting to; anything else clears
      // the properties and leaves the stylesheet's own full-height layout.
      const covered = window.innerHeight - view.height;
      const inset = view.scale <= 1.01 && covered > KEYBOARD_INSET;
      root.style.setProperty("--app-top", inset ? `${Math.round(view.offsetTop)}px` : "");
      root.style.setProperty("--app-height", inset ? `${Math.round(view.height)}px` : "");
      root.style.setProperty(
        "--app-bottom",
        inset ? `${Math.max(0, Math.round(covered - view.offsetTop))}px` : "",
      );
    };
    sync();
    view.addEventListener("resize", sync);
    view.addEventListener("scroll", sync);
    return () => {
      view.removeEventListener("resize", sync);
      view.removeEventListener("scroll", sync);
      root.style.removeProperty("--app-top");
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-bottom");
    };
  }, []);
}

/** Re-renders on a media query, for the layouts CSS alone cannot switch. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return matches;
}
