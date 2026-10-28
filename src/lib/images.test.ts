import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shrinkImage, withoutLocation } from "./images.ts";

const MB = 1024 * 1024;
let natural = { width: 0, height: 0 };
let draws: { width: number; height: number; quality: number }[] = [];
let paints = 0;

beforeEach(() => {
  draws = [];
  paints = 0;
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
        getContext: () => ({ drawImage: () => (paints += 1) }),
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
    expect(paints).toBe(new Set(draws.map((draw) => draw.width)).size);
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

describe("withoutLocation", () => {
  const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
  const u16 = (value: number) => [value >> 8, value & 0xff];
  const u32 = (value: number) => [...u16(value >>> 16), ...u16(value & 0xffff)];
  const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body];
  const latitude = [0, 0, 0, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 3, 0, 0, 0, 1];

  /** A big-endian Exif block: orientation 6, and a GPS directory with a latitude of 21° 2′ 3″ N. */
  function exif(): number[] {
    const ifd0 = [...u16(2), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(6), 0, 0, ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38), ...u32(0)];
    const gps = [...u16(2), ...u16(1), ...u16(2), ...u32(2), ...text("N"), 0, 0, 0, ...u16(2), ...u16(5), ...u32(3), ...u32(68), ...u32(0)];
    return [...text("Exif\0\0"), ...text("MM"), ...u16(42), ...u32(8), ...ifd0, ...gps, ...latitude];
  }

  const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
  const has = (haystack: number[], needle: number[]) => haystack.some((_, at) => needle.every((byte, index) => haystack[at + index] === byte));

  it("blanks a JPEG's GPS directory and drops its XMP, keeping its orientation and pixels", async () => {
    const pixels = [0xff, 0xda, 0, 4, 1, 2, 9, 9, 9, 0xff, 0xd9];
    const jpeg = [0xff, 0xd8, ...segment(0xe1, exif()), ...segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>21,2N</exif:GPSLatitude>")), ...pixels];
    const out = await bytesOf(await withoutLocation(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })));
    expect(has(out, latitude)).toBe(false);
    expect(has(out, text("GPSLatitude"))).toBe(false);
    expect(has(out, [...u16(0x0112), ...u16(3), ...u32(1), ...u16(6)])).toBe(true);
    expect(out.slice(-pixels.length)).toEqual(pixels);
    expect(out.length).toBe(jpeg.length - segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>21,2N</exif:GPSLatitude>")).length);
  });

  it("drops a PNG's Exif and text chunks and a WebP's EXIF and XMP, its header to match", async () => {
    const chunk = (type: string, body: number[]) => [...u32(body.length), ...text(type), ...body, 0, 0, 0, 0];
    const png = [0x89, ...text("PNG\r\n\x1a\n"), ...chunk("IHDR", [1, 2, 3]), ...chunk("eXIf", exif().slice(6)), ...chunk("iTXt", text("XML:com.adobe.xmp GPS")), ...chunk("IEND", [])];
    const cleanPng = await bytesOf(await withoutLocation(new Blob([new Uint8Array(png)], { type: "image/png" })));
    expect(cleanPng).toEqual([0x89, ...text("PNG\r\n\x1a\n"), ...chunk("IHDR", [1, 2, 3]), ...chunk("IEND", [])]);

    const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];
    const riff = (type: string, body: number[]) => [...text(type), ...le32(body.length), ...body, ...(body.length % 2 ? [0] : [])];
    const body = [...riff("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...riff("VP8 ", [1, 2, 3]), ...riff("EXIF", latitude), ...riff("XMP ", text("GPS"))];
    const webp = [...text("RIFF"), ...le32(4 + body.length), ...text("WEBP"), ...body];
    const cleanWebp = await bytesOf(await withoutLocation(new Blob([new Uint8Array(webp)], { type: "image/webp" })));
    const kept = [...riff("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...riff("VP8 ", [1, 2, 3])];
    expect(cleanWebp).toEqual([...text("RIFF"), ...le32(4 + kept.length), ...text("WEBP"), ...kept]);
  });
});
