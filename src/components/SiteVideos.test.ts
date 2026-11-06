// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import type { MediaVideo } from "../../shared/media.ts";

const KEY = "video/clip-0123456789ab.mp4";
const STILL = "https://m/video/clip-0123456789ab.webp";
const making: { signal: AbortSignal; finish: (still: { url: string; width: number; height: number }) => void }[] = [];
let loads = 0;

vi.mock("../lib/api.ts", async (original) => ({
  ...(await original<typeof import("../lib/api.ts")>()),
  login: async () => "session",
  fetchMediaVideos: async (): Promise<MediaVideo[]> => {
    loads += 1;
    return [{ key: KEY, url: `https://m/${KEY}`, size: 1024, uploaded: 0, poster: null, width: null, height: null, used: [] }];
  },
}));
vi.mock("../lib/db.ts", () => ({ draftStore: { all: async () => [] } }));
vi.mock("../lib/video.ts", () => ({
  makePoster: (_key: string, _progress: unknown, signal: AbortSignal) =>
    new Promise<{ url: string; width: number; height: number }>((resolve, reject) => {
      making.push({ signal, finish: resolve });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
}));

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
};

const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>(".video-row button")].find((found) => found.textContent?.trim() === text);

let unmount = () => {};

async function openVideos() {
  const { default: SiteVideos } = await import("./SiteVideos.vue");
  const { useSignIn } = await import("./useSignIn.ts");
  useSignIn().password.value = "pw";
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(SiteVideos);
  app.mount(host);
  unmount = () => app.unmount();
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Videos"]')!;
  toggle.click();
  await settle();
  return toggle;
}

beforeEach(() => {
  making.length = 0;
  loads = 0;
});

afterEach(() => {
  unmount();
  document.body.innerHTML = "";
});

it("shows the poster on the row even when the list was read again while it was being made", async () => {
  const toggle = await openVideos();
  button("Make poster")!.click();
  await settle();
  toggle.click();
  toggle.click();
  await settle();
  expect(loads).toBe(2);
  making[0].finish({ url: STILL, width: 1080, height: 1920 });
  await settle();
  expect(document.body.querySelector<HTMLImageElement>(".video-row img")?.src).toBe(STILL);
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void written.push(text) }, configurable: true });
  button("Tag")!.click();
  await settle();
  expect(written).toEqual([`<EmbedVideo src="https://m/${KEY}" poster="${STILL}" width="1080" height="1920" />`]);
  expect(button("Make poster")).toBeUndefined();
});

it("keeps the video from being deleted while its poster is made, and cancels without an error", async () => {
  await openVideos();
  expect(button("Delete")!.disabled).toBe(false);
  button("Make poster")!.click();
  await settle();
  expect(button("Delete")!.disabled).toBe(true);
  expect(button("Reading 0%")!.getAttribute("aria-disabled")).toBe("true");
  button("Reading 0%")!.click();
  expect(making).toHaveLength(1);
  button("Cancel")!.click();
  await settle();
  expect(making[0].signal.aborted).toBe(true);
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(button("Make poster")).toBeDefined();
  expect(button("Delete")!.disabled).toBe(false);
});

it("stops making the poster when the list goes away", async () => {
  await openVideos();
  button("Make poster")!.click();
  await settle();
  unmount();
  expect(making[0].signal.aborted).toBe(true);
});
