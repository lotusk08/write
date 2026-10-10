import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";
import { viewportBand } from "../lib/viewport.ts";

const GAP = 6;
const EDGE = 8;

/** Places a pop-up menu beside its button inside the visible band, and closes it on Escape or a tap outside. */
export function useFloatingMenu(
  open: Ref<boolean>,
  button: Ref<HTMLElement | null>,
  menu: Ref<HTMLElement | null>,
): void {
  const place = () => {
    const element = menu.value;
    const anchor = button.value?.getBoundingClientRect();
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
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      open.value = false;
      button.value?.focus();
    }
  };
  const onDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (!menu.value?.contains(target) && !button.value?.contains(target)) {
      open.value = false;
    }
  };
  let frame = 0;
  const follow = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(place);
  };

  const listen = () => {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    window.visualViewport?.addEventListener("resize", follow);
    window.visualViewport?.addEventListener("scroll", follow);
  };
  const unlisten = () => {
    window.cancelAnimationFrame(frame);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown);
    window.removeEventListener("resize", follow);
    window.removeEventListener("scroll", follow, true);
    window.visualViewport?.removeEventListener("resize", follow);
    window.visualViewport?.removeEventListener("scroll", follow);
  };

  watch(open, (value) => {
    unlisten();
    if (value) {
      listen();
      void nextTick(place);
    }
  });
  onBeforeUnmount(unlisten);
}
