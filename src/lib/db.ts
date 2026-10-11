import type { JSONContent } from "../editor/doc.ts";
import type { PostMeta } from "../../shared/types.ts";

export interface Draft {
  id: string;
  title: string;
  slug: string;
  doc: JSONContent;
  meta: PostMeta;
  createdAt: number;
  updatedAt: number;
  publishedPath?: string;
  publishedAt?: number;
  publishedSha?: string;
  publishedPrint?: string;
  shareToken?: string;
  shareOwner?: boolean;
  shareSeed?: Uint8Array;
}

export interface StoredImage {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  addedAt: number;
  display?: Blob | null;
}

const DB_NAME = "write";
const DB_VERSION = 1;
const DRAFTS = "drafts";
const IMAGES = "images";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFTS)) {
          db.createObjectStore(DRAFTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(IMAGES)) {
          db.createObjectStore(IMAGES, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
        globalThis.setTimeout(() => void sweepImages().catch(() => undefined), SWEEP_DELAY_MS);
      };
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.commit?.();
  });
}

export const draftStore = {
  all: () => tx<Draft[]>(DRAFTS, "readonly", (s) => s.getAll() as IDBRequest<Draft[]>),
  get: (id: string) => tx<Draft | undefined>(DRAFTS, "readonly", (s) => s.get(id) as IDBRequest<Draft | undefined>),
  put: (draft: Draft) => tx(DRAFTS, "readwrite", (s) => s.put(draft) as IDBRequest<IDBValidKey>),
  remove: async (id: string) => {
    const gone = await draftStore.get(id);
    await tx(DRAFTS, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
    if (gone) {
      const kept = localIdsIn(await draftStore.all());
      await forgetImages([...localIdsIn([gone])].filter((image) => !kept.has(image)));
    }
  },
};

export const imageStore = {
  get: (id: string) => tx<StoredImage | undefined>(IMAGES, "readonly", (s) => s.get(id) as IDBRequest<StoredImage | undefined>),
  put: (image: StoredImage) => tx(IMAGES, "readwrite", (s) => s.put(image) as IDBRequest<IDBValidKey>),
  remove: (id: string) => tx(IMAGES, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>),
  all: () => tx<StoredImage[]>(IMAGES, "readonly", (s) => s.getAll() as IDBRequest<StoredImage[]>),
};

export const LOCAL_PREFIX = "local:";

export function isLocalSrc(src: string | null | undefined): boolean {
  return typeof src === "string" && src.startsWith(LOCAL_PREFIX);
}

export function localId(src: string): string {
  return src.slice(LOCAL_PREFIX.length);
}

const LOCAL_ID = /local:([\w-]+)/g;
const SWEEP_DELAY_MS = 5000;
const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;
const DISPLAY_WIDTH = 1600;
const DISPLAYABLE = /^image\/(jpeg|png|webp)$/;

/** Every stored photo a draft points at, in its body, cover or anywhere else it keeps a `local:` address. */
export function localIdsIn(drafts: Draft[]): Set<string> {
  return new Set(drafts.flatMap((draft) => [...JSON.stringify([draft.doc, draft.meta]).matchAll(LOCAL_ID)].map((match) => match[1])));
}

async function forgetImages(ids: string[]): Promise<void> {
  for (const id of ids) {
    const url = objectUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
    void displays.get(id)?.then((shown) => shown && URL.revokeObjectURL(shown));
    displays.delete(id);
    await imageStore.remove(id);
  }
}

/**
 * Removes stored photos no draft points at any more — a publish repoints its photos to the site, outside the undo
 * history — once a day has passed since they were added, so a photo another open tab can still bring back by undo stays.
 */
export async function sweepImages(now = Date.now()): Promise<void> {
  const kept = localIdsIn(await draftStore.all());
  const stale = (await imageStore.all()).filter((image) => !kept.has(image.id) && now - image.addedAt > SWEEP_AGE_MS);
  await forgetImages(stale.map((image) => image.id));
}

const objectUrls = new Map<string, string>();
const displays = new Map<string, Promise<string | null>>();
let drawing: Promise<unknown> = Promise.resolve();

export async function resolveLocalSrc(src: string): Promise<string | null> {
  const id = localId(src);
  const cached = objectUrls.get(id);
  if (cached) {
    return cached;
  }
  const image = await imageStore.get(id);
  if (!image) {
    return null;
  }
  const url = URL.createObjectURL(image.blob);
  objectUrls.set(id, url);
  return url;
}

async function displayCopy(blob: Blob): Promise<Blob | null> {
  if (!DISPLAYABLE.test(blob.type)) {
    return null;
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth <= DISPLAY_WIDTH) {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = DISPLAY_WIDTH;
    canvas.height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * DISPLAY_WIDTH));
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const copy = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, blob.type === "image/png" ? "image/png" : "image/jpeg", 0.85),
    );
    return copy && copy.size < blob.size ? copy : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * What the editor shows for a stored photo: a copy 1600px wide, drawn once and kept beside the original, so a
 * gallery of phone originals is not decoded at full size. The original stays untouched for the upload.
 */
export function resolveDisplaySrc(src: string): Promise<string | null> {
  const id = localId(src);
  let shown = displays.get(id);
  if (!shown) {
    shown = imageStore.get(id).then(async (image) => {
      if (!image) {
        return null;
      }
      let display = image.display;
      if (display === undefined) {
        const drawn = drawing.then(() => displayCopy(image.blob));
        drawing = drawn;
        display = await drawn;
        void imageStore.put({ ...image, display }).catch(() => undefined);
      }
      return URL.createObjectURL(display ?? image.blob);
    });
    displays.set(id, shown);
  }
  return shown;
}

/** Lets go of the shown copies, except those still on the page. */
export function releaseDisplays(inUse: Set<string>): void {
  for (const [id, shown] of displays) {
    if (!inUse.has(id)) {
      void shown.then((url) => url && URL.revokeObjectURL(url));
      displays.delete(id);
    }
  }
}

export async function storeImageFile(file: File | Blob, name?: string): Promise<StoredImage> {
  const image: StoredImage = {
    id: crypto.randomUUID(),
    name: name || (file instanceof File ? file.name : "image.png"),
    type: file.type || "image/png",
    blob: file,
    addedAt: Date.now(),
  };
  await imageStore.put(image);
  return image;
}
