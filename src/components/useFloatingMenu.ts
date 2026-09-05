import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { viewportBand } from "../lib/viewport.ts";

const GAP = 6;
const EDGE = 8;

export function useFloatingMenu(
  open: boolean,
  close: () => void,
  button: RefObject<HTMLButtonElement | null>,
  menu: RefObject<HTMLDivElement | null>,
): void {
  const place = useCallback(() => {
    const element = menu.current;
    const anchor = button.current?.getBoundingClientRect();
    if (!element || !anchor) {
      return;
    }
    const band = viewportBand();
    element.style.left = "0px";
    element.style.top = "0px";
    element.style.maxHeight = `${band.height - EDGE * 2}px`;
    const box = element.getBoundingClientRect();

    const above = anchor.top - GAP - box.height;
    const top =
      above >= band.top + EDGE
        ? above
        : Math.max(band.top + EDGE, Math.min(anchor.bottom + GAP, band.bottom - EDGE - box.height));
    const left = Math.max(band.left + EDGE, Math.min(anchor.left - GAP, band.right - EDGE - box.width));
    element.style.top = `${Math.round(top)}px`;
    element.style.left = `${Math.round(left)}px`;
  }, [button, menu]);

  useLayoutEffect(() => {
    if (open) {
      place();
    }
  }, [open, place]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        button.current?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        close();
      }
    };
    let frame = 0;
    const follow = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(place);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", follow, true);
      window.visualViewport?.removeEventListener("resize", follow);
      window.visualViewport?.removeEventListener("scroll", follow);
    };
  }, [open, close, place, button, menu]);
}
