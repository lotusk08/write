import { describe, expect, it, vi } from "vitest";
import type { Draft } from "./db.ts";
import type { Settings } from "./settings.ts";

const sitePhotos = vi.hoisted(() => vi.fn());
vi.mock("./api.ts", () => ({ fetchSitePhotos: sitePhotos }));

const { buildPublishPlan } = await import("./publish.ts");

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
    expect(plan.expect).toEqual({ path: "src/posts/2026-10-11-trip.md", sha: "" });
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
      "public/assets/img/post/trip-bien.jpg",
      "public/assets/img/post/trip-nui.webp",
    ]);
    expect(plan.remove).toEqual(["public/assets/img/post/IMG 1.jpg"]);
    expect(plan.redirects).toEqual([["/assets/img/post/IMG%201.webp", "/assets/img/post/trip-bien.webp"]]);
    expect(plan.markdown).toContain("/assets/img/post/trip-bien.jpg");
    expect(plan.expect).toEqual({ path: "src/posts/2026-10-11-trip.md", sha: "c".repeat(40) });
  });

  it("counts a post moved to a new address as still using its photos", async () => {
    sitePhotos.mockResolvedValueOnce({ files: [], redirected: [] });
    await buildPublishPlan(draft({ publishedPath: "src/posts/2026-10-10-trip.md" }, [["/assets/img/post/a.webp", "A"]]), settings);
    expect(sitePhotos).toHaveBeenLastCalledWith(["src/posts/2026-10-11-trip.md"]);
    sitePhotos.mockResolvedValueOnce({ files: [], redirected: [] });
    await buildPublishPlan(draft({ publishedPath: "src/drafts/2026-10-11-trip.md" }, [["/assets/img/post/a.webp", "A"]]), settings);
    expect(sitePhotos).toHaveBeenLastCalledWith(["src/posts/2026-10-11-trip.md", "src/drafts/2026-10-11-trip.md"]);
  });
});
