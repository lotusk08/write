import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shrinkImage } from "./images.ts";

const MB = 1024 * 1024;
let natural = { width: 0, height: 0 };
let draws: { width: number; height: number; quality: number }[] = [];

beforeEach(() => {
  draws = [];
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      get naturalWidth() {
        return natural.width;
      }
      get naturalHeight() {
        return natural.height;
      }
      decode() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (done: (blob: Blob) => void, type: string, quality: number) => {
          draws.push({ width: canvas.width, height: canvas.height, quality });
          const bytes = canvas.width * canvas.height * (type === "image/png" ? 3 : quality * 1.2);
          done(new Blob([new Uint8Array(Math.round(bytes))], { type }));
        },
      };
      return canvas;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const photo = (size: number, type = "image/jpeg") => new Blob([new Uint8Array(size)], { type });

describe("shrinkImage", () => {
  it("sends a photo within 4K and 4 MB as it is, drawing nothing", async () => {
    natural = { width: 3000, height: 2000 };
    const original = photo(3 * MB);
    expect(await shrinkImage(original)).toBe(original);
    expect(draws).toEqual([]);
  });

  it("brings a heavy 4K JPEG under 4 MB by quality first, then width", async () => {
    natural = { width: 3840, height: 2880 };
    const shrunk = await shrinkImage(photo(9 * MB));
    expect(shrunk.size).toBeLessThanOrEqual(4 * MB);
    expect(draws[0]).toMatchObject({ width: 3840, quality: 0.95 });
    expect(draws.map((draw) => draw.quality).every((quality) => quality >= 0.7 - 1e-9)).toBe(true);
  });

  it("narrows a 48 MP portrait within the canvas area a phone allows", async () => {
    natural = { width: 6048, height: 8064 };
    const shrunk = await shrinkImage(photo(12 * MB));
    expect(draws[0].width).toBeLessThanOrEqual(3840);
    expect(draws.every((draw) => draw.width * draw.height <= 16_777_216)).toBe(true);
    expect(shrunk.size).toBeLessThanOrEqual(4 * MB);
  });

  it("only narrows a PNG, and stops after a bounded number of tries", async () => {
    natural = { width: 8000, height: 8000 };
    const shrunk = await shrinkImage(photo(40 * MB, "image/png"));
    expect(new Set(draws.map((draw) => draw.quality)).size).toBe(1);
    expect(draws.length).toBeLessThanOrEqual(20);
    expect(shrunk.type).toBe("image/png");
    expect(shrunk.size).toBeLessThanOrEqual(4 * MB);
  });

  it("keeps an original within 4K that no redraw made smaller", async () => {
    natural = { width: 2000, height: 1500 };
    const original = photo(4 * MB + 1);
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob: (done: (blob: Blob) => void) => done(photo(5 * MB)) }),
    });
    expect(await shrinkImage(original)).toBe(original);
  });

  it("passes formats it cannot redraw through whole", async () => {
    const gif = photo(20 * MB, "image/gif");
    expect(await shrinkImage(gif)).toBe(gif);
  });
});
