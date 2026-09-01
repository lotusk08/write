import { useEffect, useState } from "react";

export const PHONE_QUERY = "(width <= 640px)";

const KEYBOARD_INSET = 120;

export interface ViewportBand {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function viewportBand(): ViewportBand {
  const view = window.visualViewport;
  const top = view?.offsetTop ?? 0;
  const left = view?.offsetLeft ?? 0;
  const width = view?.width ?? window.innerWidth;
  const height = view?.height ?? window.innerHeight;
  return { top, left, width, height, right: left + width, bottom: top + height };
}

export function usePinnedViewport(): void {
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) {
      return;
    }
    const root = document.documentElement;
    const sync = () => {
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
