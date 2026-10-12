<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { PostMeta } from "../../shared/types.ts";
import { resolvedTheme, type Settings } from "../lib/settings.ts";
import { PHONE_QUERY, useMediaQuery } from "../lib/viewport.ts";
import Icon from "./Icon.vue";
import type { IconName } from "./icons.ts";
import ExportPanel from "./panels/ExportPanel.vue";
import PostPanel from "./panels/PostPanel.vue";
import Section from "./panels/Section.vue";
import SharePanel from "./panels/SharePanel.vue";
import SiteDrafts from "./SiteDrafts.vue";
import type { DoneAction, ExportFormat, ShareState } from "./types.ts";

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor: HTMLElement | null;
    region: HTMLElement | null;
    meta: PostMeta;
    slug: string;
    settings: Settings;
    share: ShareState;
    exporting: boolean;
    done?: DoneAction | null;
    escapeCloses?: boolean;
  }>(),
  { done: null, escapeCloses: true },
);

const emit = defineEmits<{
  close: [];
  meta: [patch: Partial<PostMeta>];
  slug: [slug: string];
  settings: [patch: Partial<Settings>];
  shareName: [name: string];
  share: [];
  shareCopy: [];
  shareDisable: [];
  publish: [];
  site: [path: string];
  mindmap: [];
  export: [formats: ExportFormat[]];
}>();

const panel = ref<HTMLDivElement | null>(null);
const frame = ref<DOMRect | null>(null);
const chosen = ref<ExportFormat[]>([]);
const sheet = useMediaQuery(PHONE_QUERY);

const scheme = computed(() => resolvedTheme(props.settings.theme));

const DONE_TEXT: Record<DoneAction, string> = {
  share: "Share link copied",
  link: "Share link copied",
  export: "Exported",
  copy: "Markdown copied",
};

/** A button's icon and label, a tick and what happened while `done` names its action. */
const icon = (action: DoneAction, name: IconName): IconName => (props.done === action ? "check" : name);
const label = (action: DoneAction, text: string, result: string) => (props.done === action ? result : text);

const position = computed(() => {
  const box = frame.value;
  if (!box) {
    return {};
  }
  const inset = sheet.value ? 10 : 16;
  return sheet.value
    ? {
        left: `${box.left + inset}px`,
        right: `${window.innerWidth - box.right + inset}px`,
        bottom: `${window.innerHeight - box.bottom + inset}px`,
        maxHeight: `${Math.max(200, box.height - inset * 2)}px`,
      }
    : {
        top: `${box.top + inset}px`,
        right: `${window.innerWidth - box.right + inset}px`,
        maxHeight: `${Math.max(240, box.height - inset * 2)}px`,
      };
});

/** Closing from inside the sheet hands focus back to the ⌘ button it covered. */
const dismiss = () => {
  const inside = Boolean(panel.value?.contains(document.activeElement));
  emit("close");
  if (inside) {
    window.requestAnimationFrame(() => props.anchor?.focus({ preventScroll: true }));
  }
};

const measure = () => {
  frame.value = props.region?.getBoundingClientRect() ?? null;
};
const onKey = (event: KeyboardEvent) => {
  if (event.key === "Escape" && props.escapeCloses) {
    dismiss();
  }
};
/** A tap outside closes the menu, but not one in the site's drafts list, which opens from it and floats beside it. */
const onDown = (event: PointerEvent) => {
  const target = event.target as Element;
  if (panel.value?.contains(target) || props.anchor?.contains(target) || target.closest?.(".draft-list")) {
    return;
  }
  emit("close");
};

let observer: ResizeObserver | null = null;
const stop = () => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("resize", measure);
  window.visualViewport?.removeEventListener("resize", measure);
  window.visualViewport?.removeEventListener("scroll", measure);
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("pointerdown", onDown);
};

watch(
  () => [props.open, props.region] as const,
  ([open, region]) => {
    stop();
    if (!open || !region) {
      frame.value = null;
      return;
    }
    measure();
    observer = new ResizeObserver(measure);
    observer.observe(region);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
  },
  { immediate: true },
);
onBeforeUnmount(stop);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && frame"
      ref="panel"
      :class="['popover', { 'is-sheet': sheet }]"
      role="dialog"
      aria-label="Editor menu"
      :style="position"
    >
      <header class="popover-head">
        <button
          type="button"
          class="btn icon ghost"
          :title="scheme === 'dark' ? 'Switch to light' : 'Switch to dark'"
          :aria-label="scheme === 'dark' ? 'Switch to light' : 'Switch to dark'"
          @click="emit('settings', { theme: scheme === 'dark' ? 'light' : 'dark' })"
        >
          <Icon :name="scheme === 'dark' ? 'sun' : 'moon'" />
        </button>
        <button
          type="button"
          :class="['btn icon ghost', { 'is-active': settings.focusMode }]"
          title="Focus mode — hides the toolbar and the draft rail"
          aria-label="Focus mode"
          :aria-pressed="settings.focusMode"
          @click="emit('settings', { focusMode: !settings.focusMode })"
        >
          <Icon name="focus" />
        </button>
        <button v-if="sheet" type="button" class="btn icon ghost" title="Close" aria-label="Close menu" @click="dismiss">
          <Icon name="close" />
        </button>
      </header>

      <div class="popover-body">
        <PostPanel :meta="meta" :slug="slug" @change="(patch) => emit('meta', patch)" @slug="(value) => emit('slug', value)" />
        <Section>
          <ExportPanel :chosen="chosen" :exporting="exporting" @change="(next) => (chosen = next)" />
        </Section>
        <Section v-if="share.sharing || share.error" id="menu-share">
          <SharePanel
            :state="share"
            @name="(name) => emit('shareName', name)"
            :copied="done === 'link'"
            @copy="emit('shareCopy')"
            @disable="emit('shareDisable')"
          />
        </Section>
      </div>

      <footer class="popover-foot">
        <div class="foot-actions">
          <button type="button" class="btn primary" title="Review, then publish to the blog" @click="emit('publish')">
            <Icon name="upload" />
            Publish
          </button>
          <button
            type="button"
            :class="['btn', { 'is-active': share.sharing, 'is-done': done === 'share' }]"
            :disabled="share.busy"
            :title="share.sharing ? 'Copy the share link' : 'Share this draft to edit it together, and copy the link'"
            @click="emit('share')"
          >
            <Icon :name="icon('share', 'people')" />
            {{ share.busy ? "Sharing…" : label("share", "Share", "Copied") }}
          </button>
          <button
            type="button"
            :class="['btn', { 'is-done': done === 'export' }]"
            :disabled="exporting || chosen.length === 0"
            :title="chosen.length === 0 ? 'Tick a format above first' : `Export ${chosen.length} format${chosen.length === 1 ? '' : 's'}`"
            @click="emit('export', chosen)"
          >
            <Icon :name="icon('export', 'download')" />
            {{ exporting ? "Exporting…" : label("export", "Export", "Exported") }}
          </button>
          <button
            type="button"
            :class="['btn', { 'is-done': done === 'copy' }]"
            :disabled="exporting"
            title="Copy the Markdown to the clipboard — ⌘⇧C"
            @click="emit('export', ['copy'])"
          >
            <Icon :name="icon('copy', 'copy')" />
            {{ label("copy", "Copy", "Copied") }}
          </button>
          <button type="button" class="btn" title="View it in the mindmap — think.stevehoang.com" @click="emit('mindmap')">
            <Icon name="mindmap" />
            View
          </button>
        </div>
        <SiteDrafts @open="(path) => emit('site', path)" />
        <span class="sr-only" role="status">{{ done ? DONE_TEXT[done] : "" }}</span>
      </footer>
    </div>
  </Teleport>
</template>
