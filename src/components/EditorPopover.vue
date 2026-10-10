<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { PostMeta } from "../../shared/types.ts";
import { resolvedTheme, type MenuTab, type Settings } from "../lib/settings.ts";
import { PHONE_QUERY, useMediaQuery } from "../lib/viewport.ts";
import Icon from "./Icon.vue";
import ExportPanel from "./panels/ExportPanel.vue";
import PostPanel from "./panels/PostPanel.vue";
import SharePanel from "./panels/SharePanel.vue";
import type { ExportFormat, ShareState } from "./types.ts";

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor: HTMLElement | null;
    region: HTMLElement | null;
    tab: MenuTab;
    meta: PostMeta;
    slug: string;
    settings: Settings;
    share: ShareState;
    exporting: boolean;
    escapeCloses?: boolean;
  }>(),
  { escapeCloses: true },
);

const emit = defineEmits<{
  tab: [tab: MenuTab];
  close: [];
  meta: [patch: Partial<PostMeta>];
  slug: [slug: string];
  settings: [patch: Partial<Settings>];
  shareName: [name: string];
  shareEnable: [];
  shareDisable: [];
  shareCopy: [];
  publish: [];
  mindmap: [];
  export: [formats: ExportFormat[]];
}>();

const TABS: { id: MenuTab; label: string }[] = [
  { id: "post", label: "Post" },
  { id: "export", label: "Export" },
  { id: "share", label: "Share" },
];

const panel = ref<HTMLDivElement | null>(null);
const frame = ref<DOMRect | null>(null);
const chosen = ref<ExportFormat[]>([]);
const sheet = useMediaQuery(PHONE_QUERY);

const scheme = computed(() => resolvedTheme(props.settings.theme));
const publishDir = computed(() =>
  (props.settings.publishTarget === "drafts" ? props.settings.draftsDir : props.settings.postsDir).replace(
    /^\/+|\/+$/g,
    "",
  ),
);

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
const onDown = (event: PointerEvent) => {
  const target = event.target as Node;
  if (panel.value?.contains(target) || props.anchor?.contains(target)) {
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
        <div class="popover-tabs" role="tablist">
          <button
            v-for="item in TABS"
            :key="item.id"
            type="button"
            role="tab"
            :class="['popover-tab', { 'is-active': tab === item.id }]"
            :aria-selected="tab === item.id"
            @click="emit('tab', item.id)"
          >
            {{ item.label }}
          </button>
        </div>
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
        <PostPanel
          v-if="tab === 'post'"
          :meta="meta"
          :slug="slug"
          @change="(patch) => emit('meta', patch)"
          @slug="(value) => emit('slug', value)"
        />
        <SharePanel
          v-else-if="tab === 'share'"
          :state="share"
          @name="(name) => emit('shareName', name)"
          @enable="emit('shareEnable')"
          @disable="emit('shareDisable')"
        />
        <ExportPanel v-else :chosen="chosen" :exporting="exporting" @change="(next) => (chosen = next)" />
      </div>

      <footer class="popover-foot">
        <template v-if="tab === 'export'">
          <div class="foot-row">
            <button
              type="button"
              class="btn primary block"
              :disabled="exporting || chosen.length === 0"
              @click="emit('export', chosen)"
            >
              <Icon name="download" />
              {{ exporting ? "Exporting…" : "Export" }}
            </button>
            <button
              type="button"
              class="btn icon"
              title="Copy the Markdown to the clipboard — ⌘⇧C"
              aria-label="Copy the Markdown to the clipboard"
              :disabled="exporting"
              @click="emit('export', ['copy'])"
            >
              <Icon name="copy" />
            </button>
            <button
              type="button"
              class="btn icon"
              title="Open in the mindmap — think.stevehoang.com"
              aria-label="Open in the mindmap"
              @click="emit('mindmap')"
            >
              <Icon name="mindmap" />
            </button>
          </div>
          <p class="hint publish-target">
            {{ chosen.length === 0 ? "Choose the format before download" : `${chosen.length} selected` }}
          </p>
        </template>
        <template v-else-if="tab === 'share'">
          <button
            type="button"
            class="btn primary block"
            :disabled="!share.sharing || !share.link"
            @click="emit('shareCopy')"
          >
            <Icon name="copy" />
            Copy link
          </button>
          <p class="hint publish-target">
            {{
              share.busy
                ? share.sharing
                  ? "Turning on…"
                  : "Turning off…"
                : share.sharing
                  ? "Live — everyone with the link edits this draft"
                  : "Not shared"
            }}
          </p>
        </template>
        <template v-else>
          <button type="button" class="btn primary block" @click="emit('publish')">
            <Icon name="upload" />
            Publish
          </button>
          <p class="hint publish-target">
            <span class="mono">{{ publishDir }}/</span>
          </p>
        </template>
      </footer>
    </div>
  </Teleport>
</template>
