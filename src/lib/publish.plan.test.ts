import { describe, expect, it, vi } from "vitest";
import type { Draft } from "./db.ts";
import type { Settings } from "./settings.ts";

const sitePhotos = vi.hoisted(() => vi.fn());
vi.mock("./api.ts", () => ({ fetchSitePhotos: sitePhotos }));

const { buildPublishPlan, sendPlan } = await import("./publish.ts");

const settings = {
  imagesDir: "public/assets/img/post",
  postsDir: "src/posts",
  draftsDir: "src/drafts",
  publishTarget: "posts",
} as Settings;

const draft = (extra: Partial<Draft>, photos: [string, string][] = []) =>
  ({
    slug: "trip",
    meta: { title: "Trip", description: "", date: "2026-10-11T08:00:00+07:00", lang: "vi", tags: [], pin: false, toc: false, cover: null },
    doc: { type: "doc", content: photos.map(([src, alt]) => ({ type: "image", attrs: { src, alt } })) },
    ...extra,
  }) as unknown as Draft;

describe("buildPublishPlan", () => {
  it("guards a new post against landing on an existing one", async () => {
    const plan = await buildPublishPlan(draft({}), settings);
    expect(plan.expect).toEqual([{ path: "src/posts/2026-10-11-trip.md", sha: "" }]);
  });

  it("renames a site photo written two ways once, both addresses pointed at its new name", async () => {
    sitePhotos.mockResolvedValueOnce({ files: [{ name: "IMG_1.jpg", sha: "a".repeat(40), shared: false }], redirected: [] });
    const plan = await buildPublishPlan(
      draft({
        publishedPath: "src/posts/2026-10-11-trip.md",
        publishedSha: "c".repeat(40),
        meta: { ...draft({}).meta, cover: { path: "/assets/img/post/IMG_1.webp", alt: "Sea" } },
      }, [["/assets/img/post/IMG_1.jpg", "Sea"]]),
      settings,
    );
    expect(plan.renames.map((rename) => rename.path)).toEqual(["public/assets/img/post/sea.jpg"]);
    expect(plan.remove).toEqual(["public/assets/img/post/IMG_1.jpg"]);
    expect(plan.redirects).toHaveLength(1);
    expect(plan.markdown).toContain("![Sea](/assets/img/post/sea.jpg)");
    expect(plan.markdown).toContain("path: /assets/img/post/sea.jpg");
  });

  it("redirects a renamed JPEG at the WebP the site serves, and keeps a file another post uses", async () => {
    sitePhotos.mockResolvedValueOnce({
      files: [
        { name: "IMG 1.jpg", sha: "a".repeat(40), shared: false },
        { name: "old.webp", sha: "b".repeat(40), shared: true },
      ],
      redirected: [],
    });
    const plan = await buildPublishPlan(
      draft({ publishedPath: "src/posts/2026-10-11-trip.md", publishedSha: "c".repeat(40) }, [
        ["/assets/img/post/IMG%201.jpg", "Biển"],
        ["/assets/img/post/old.webp", "Núi"],
      ]),
      settings,
    );
    expect(sitePhotos).toHaveBeenCalledWith(["src/posts/2026-10-11-trip.md"]);
    expect(plan.renames.map((rename) => rename.path)).toEqual([
      "public/assets/img/post/bien.jpg",
      "public/assets/img/post/nui.webp",
    ]);
    expect(plan.remove).toEqual(["public/assets/img/post/IMG 1.jpg"]);
    expect(plan.redirects).toEqual([["/assets/img/post/IMG%201.webp", "/assets/img/post/bien.webp"]]);
    expect(plan.markdown).toContain("/assets/img/post/bien.jpg");
    expect(plan.expect).toEqual([{ path: "src/posts/2026-10-11-trip.md", sha: "c".repeat(40) }]);
  });

  it("counts a post moved to a new address as still using its photos", async () => {
    sitePhotos.mockResolvedValueOnce({ files: [], redirected: [] });
    await buildPublishPlan(draft({ publishedPath: "src/posts/2026-10-10-trip.md" }, [["/assets/img/post/a.webp", "A"]]), settings);
    expect(sitePhotos).toHaveBeenLastCalledWith(["src/posts/2026-10-11-trip.md"]);
    sitePhotos.mockResolvedValueOnce({ files: [], redirected: [] });
    await buildPublishPlan(draft({ publishedPath: "src/drafts/2026-10-11-trip.md" }, [["/assets/img/post/a.webp", "A"]]), settings);
    expect(sitePhotos).toHaveBeenLastCalledWith(["src/posts/2026-10-11-trip.md", "src/drafts/2026-10-11-trip.md"]);
  });

  it("guards the new address too when a post moves, and keeps the old one checked", async () => {
    const plan = await buildPublishPlan(
      draft({ publishedPath: "src/drafts/2026-10-11-old.md", publishedSha: "d".repeat(40) }),
      settings,
    );
    expect(plan.expect).toEqual([
      { path: "src/posts/2026-10-11-trip.md", sha: "" },
      { path: "src/drafts/2026-10-11-old.md", sha: "d".repeat(40) },
    ]);
  });

  it("warns about a photo with no caption and a missing description", async () => {
    const plan = await buildPublishPlan(draft({}), settings);
    expect(plan.warnings.map((warning) => warning.kind)).toContain("description");
  });

  it("stops a post the site's build would stop on: no title, or a date that is no day", async () => {
    const meta = (patch: Record<string, unknown>) => draft({ meta: { ...draft({}).meta, ...patch } });
    const blocking = async (patch: Record<string, unknown>, target: Settings["publishTarget"] = "posts") =>
      (await buildPublishPlan(meta(patch), { ...settings, publishTarget: target })).warnings
        .filter((warning) => warning.blocks)
        .map((warning) => warning.kind);
    expect(await blocking({})).toEqual([]);
    expect(await blocking({ date: "2026-10-18 09:00 +0700" })).toEqual([]);
    expect(await blocking({ date: "2026-10-18" })).toEqual([]);
    expect(await blocking({ title: " " })).toEqual(["title"]);
    expect(await blocking({ date: "2026-02-30 09:00 +0700" })).toEqual(["date"]);
    expect(await blocking({ date: "yesterday" })).toEqual(["date"]);
    expect(await blocking({ date: " 2026-10-18" })).toEqual(["date"]);
    expect(await blocking({ title: "", date: "" }, "drafts")).toEqual([]);
  });

  it("says a hidden post will not be live", async () => {
    const hidden = draft({ meta: { ...draft({}).meta, extra: ["comments: false", "hidden: true # for now"] } });
    expect((await buildPublishPlan(hidden, settings)).warnings.map((warning) => warning.kind)).toContain("hidden");
    const shown = draft({ meta: { ...draft({}).meta, extra: ["hidden: false", "hiddenly: true"] } });
    expect((await buildPublishPlan(shown, settings)).warnings.map((warning) => warning.kind)).not.toContain("hidden");
  });

  it("refuses a photo too big to send before uploading any", async () => {
    const gif = new Blob([new Uint8Array(9 * 1024 * 1024)], { type: "image/gif" });
    const plan = {
      ...(await buildPublishPlan(draft({}), settings)),
      photos: [{ path: "public/assets/img/post/trip-1.gif", blob: gif, src: "local:1", alt: "" }],
    };
    await expect(sendPlan(plan, "m", "pw", () => {})).rejects.toThrow("trip-1.gif is 9.0 MB");
  });
});
