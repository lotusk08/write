import { describe, expect, it } from "vitest";
import type { Draft } from "./db.ts";
import type { Settings } from "./settings.ts";
import { leavesDraft, photoName, planImages } from "./publish.ts";

describe("photoName", () => {
  it("names a photo after its alt, folded to ASCII", () => {
    expect(photoName("da-lat", "Đồi thông ở Đà Lạt", new Set())).toBe("da-lat-doi-thong-o-da-lat");
  });

  it("numbers a photo with no alt past every name taken", () => {
    expect(photoName("trip", "", new Set(["trip-1", "trip-2"]))).toBe("trip-3");
  });

  it("never reuses a name, and remembers the ones it gives", () => {
    const taken = new Set(["trip-sea"]);
    expect(photoName("trip", "Sea", taken)).toBe("trip-sea-2");
    expect(photoName("trip", "Sea", taken)).toBe("trip-sea-3");
  });

  it("cuts a long alt on a word boundary", () => {
    const name = photoName("p", "a long caption that keeps going well past the fifty character mark", new Set());
    expect(name).toBe("p-a-long-caption-that-keeps-going-well-past-the");
  });
});

describe("planImages", () => {
  const draft = (photos: [string, string][]) =>
    ({
      meta: { cover: null },
      doc: { type: "doc", content: photos.map(([src, alt]) => ({ type: "image", attrs: { src, alt } })) },
    }) as unknown as Draft;
  const site = (...names: string[]) => names.map((name) => ({ name, sha: name, shared: false }));

  it("renames a published photo to follow its alt, keeping the file the repo has", async () => {
    const planned = await planImages(
      draft([["/assets/img/post/old-1.jpg", "Biển xanh"]]),
      "trip",
      "assets/img/post",
      site("old-1.webp", "trip-bien-xanh.webp"),
    );
    expect(planned.map((image) => [image.site?.name, image.baseName])).toEqual([["old-1.webp", "trip-bien-xanh-2"]]);
  });

  it("leaves a photo already named after its alt, or with no alt", async () => {
    const planned = await planImages(
      draft([
        ["/assets/img/post/trip-sea-2.webp", "Sea"],
        ["/assets/img/post/old.webp", ""],
      ]),
      "trip",
      "assets/img/post",
      site("trip-sea-2.webp", "old.webp"),
    );
    expect(planned).toEqual([]);
  });
});

describe("leavesDraft", () => {
  const settings = { draftsDir: "src/drafts" } as Settings;
  const opened = (publishedPath?: string) => ({ publishedPath }) as Draft;

  it("moves a draft opened from the site when it is published elsewhere", () => {
    expect(leavesDraft(opened("src/drafts/2024-04-20-coffee.md"), settings, "src/posts/2024-04-20-coffee.md")).toBe(true);
  });

  it("keeps a draft written back to its own file, and never touches a post", () => {
    expect(leavesDraft(opened("src/drafts/2024-04-20-coffee.md"), settings, "src/drafts/2024-04-20-coffee.md")).toBe(false);
    expect(leavesDraft(opened("src/posts/2024-04-20-coffee.md"), settings, "src/posts/2024-04-21-coffee.md")).toBe(false);
    expect(leavesDraft(opened(), settings, "src/posts/2024-04-20-coffee.md")).toBe(false);
  });
});

describe("photo names under load", () => {
  const draft = (photos: [string, string][]) =>
    ({
      meta: { cover: null },
      doc: { type: "doc", content: [{ type: "gallery", content: photos.map(([src, alt]) => ({ type: "image", attrs: { src, alt } })) }] },
    }) as unknown as Draft;

  it("gives two hundred photos with colliding, empty and odd alts two hundred distinct names", () => {
    const alts = ["Biển", "biển", "BIỂN!", "", "   ", "!!!", "🌊🌊", "Đà Lạt — sáng", "x".repeat(300), "a b c ".repeat(40), "Ảnh 1"];
    const existing = new Set(Array.from({ length: 500 }, (_, index) => (index % 2 ? `trip-bien-${index}` : `trip-${index}`)));
    const taken = new Set(existing);
    const names = Array.from({ length: 200 }, (_, index) => photoName("trip", alts[index % alts.length], taken));
    expect(new Set(names).size).toBe(200);
    expect(names.filter((name) => existing.has(name))).toEqual([]);
    for (const name of names) {
      expect(name).toMatch(/^trip-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(name.length).toBeLessThanOrEqual("trip-".length + 50 + 4);
    }
  });

  it("renames two hundred published photos without a clash, past redirected addresses too", async () => {
    const photos = Array.from({ length: 200 }, (_, index): [string, string] => [`/assets/img/post/IMG_${index}.jpg`, index % 3 ? "Hồ Gươm" : "Phố cổ"]);
    const site = photos.map(([src]) => ({ name: src.split("/").pop()!.replace(".jpg", ".webp"), sha: src, shared: false }));
    const planned = await planImages(draft(photos), "ha-noi", "assets/img/post", site, ["ha-noi-ho-guom.webp", "ha-noi-pho-co-2.webp"]);
    const names = planned.map((image) => image.baseName);
    expect(planned).toHaveLength(200);
    expect(new Set(names).size).toBe(200);
    expect(names).not.toContain("ha-noi-ho-guom");
    expect(names).not.toContain("ha-noi-pho-co-2");
    expect(planned.every((image) => image.site?.name.endsWith(".webp"))).toBe(true);
  });

  it("leaves a photo alone when the site has no file for it", async () => {
    expect(await planImages(draft([["/assets/img/post/gone.webp", "Biển"], ["https://elsewhere/x.jpg", "Biển"]]), "trip", "assets/img/post", [])).toEqual([]);
  });
});
