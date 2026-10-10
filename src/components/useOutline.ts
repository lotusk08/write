import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from "vue";
import { placeCaret } from "../editor/commands.ts";

export interface OutlineEntry {
  key: number;
  level: number;
  text: string;
  element: HTMLElement;
}

export interface Outline {
  entries: Ref<OutlineEntry[]>;
  active: Ref<number | null>;
  scrolled: Ref<boolean>;
  go: (entry: OutlineEntry) => void;
}

const ACTIVE_OFFSET_PX = 64;
const SETTLE_MS = 120;
const JUMP_MS = 320;
const JUMP_MARGIN_PX = 40;

/**
 * A fixed 320ms ease-out: Chrome's own smooth scroll inside an overflow
 * container scales with distance and took a second and a half across a long
 * post, where the blog's document scroll feels instant.
 */
function jumpTo(container: HTMLElement, to: number): boolean {
  const from = container.scrollTop;
  const target = Math.max(0, Math.min(to, container.scrollHeight - container.clientHeight));
  const delta = target - from;
  if (!delta || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    container.scrollTop = target;
    return false;
  }
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  container.addEventListener("wheel", cancel, { passive: true, once: true });
  container.addEventListener("touchstart", cancel, { passive: true, once: true });
  const start = performance.now();
  const step = (now: number) => {
    if (cancelled) {
      return;
    }
    const t = Math.min(1, (now - start) / JUMP_MS);
    container.scrollTop = from + delta * (1 - (1 - t) ** 3);
    if (t < 1) {
      window.requestAnimationFrame(step);
    } else {
      container.removeEventListener("wheel", cancel);
      container.removeEventListener("touchstart", cancel);
    }
  };
  window.requestAnimationFrame(step);
  return true;
}

function headings(root: HTMLElement | null): OutlineEntry[] {
  if (!root) {
    return [];
  }
  return [...root.querySelectorAll<HTMLElement>("h2, h3, h4")].map((element, key) => ({
    key,
    level: Number(element.tagName.slice(1)),
    text: element.textContent ?? "",
    element,
  }));
}

function sameOutline(a: OutlineEntry[], b: OutlineEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return entry.level === other.level && entry.text === other.text && entry.element === other.element;
    })
  );
}

/** The post's H2–H4, the one being read, and a jump to each — the blog's tocbot, inside the editor. */
export function useOutline(
  root: Ref<HTMLElement | null>,
  scroll: Ref<HTMLElement | null>,
  enabled: Ref<boolean>,
  version: Ref<number>,
): Outline {
  const entries = shallowRef<OutlineEntry[]>([]);
  const active = ref<number | null>(null);
  const scrolled = ref(false);
  let frame: number | undefined;
  let settle: number | undefined;
  let jumping = false;

  const measure = () => {
    frame = undefined;
    const container = scroll.value;
    if (!container) {
      return;
    }
    const edge = container.getBoundingClientRect().top;
    const top = edge + ACTIVE_OFFSET_PX;
    let found: number | null = null;
    for (const entry of entries.value) {
      const rect = entry.element.getBoundingClientRect();
      if (rect.height === 0) {
        continue;
      }
      if (rect.top > top) {
        break;
      }
      found = entry.key;
    }
    active.value = found ?? entries.value[0]?.key ?? null;
    const title = container.querySelector(".title-input");
    scrolled.value = title ? title.getBoundingClientRect().bottom < edge : container.scrollTop > 0;
  };

  const schedule = () => {
    if (jumping) {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        jumping = false;
        measure();
      }, SETTLE_MS);
      return;
    }
    frame ??= window.requestAnimationFrame(measure);
  };

  const stop = () => {
    document.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    window.clearTimeout(settle);
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  watch(
    [root, enabled, version],
    () => {
      const next = enabled.value ? headings(root.value) : [];
      if (!sameOutline(entries.value, next)) {
        entries.value = next;
      }
    },
    { immediate: true, flush: "post" },
  );

  watch(
    [entries, scroll, enabled],
    () => {
      stop();
      if (!scroll.value || !enabled.value) {
        active.value = null;
        scrolled.value = false;
        return;
      }
      schedule();
      document.addEventListener("scroll", schedule, { capture: true, passive: true });
      window.addEventListener("resize", schedule);
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(stop);

  const go = (entry: OutlineEntry) => {
    const container = scroll.value;
    if (window.matchMedia("(pointer: fine)").matches) {
      root.value?.focus({ preventScroll: true });
      placeCaret(entry.element, false);
    }
    active.value = entry.key;
    if (!container) {
      return;
    }
    jumping = true;
    window.clearTimeout(settle);
    const to =
      entry.element.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      JUMP_MARGIN_PX;
    if (!jumpTo(container, to)) {
      jumping = false;
    }
  };

  return { entries, active, scrolled, go };
}
