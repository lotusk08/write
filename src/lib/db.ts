import type { JSONContent } from "@tiptap/core";
import type { PostMeta } from "../../shared/types.ts";

export interface Draft {
  id: string;
  title: string;
  slug: string;
  doc: JSONContent;
  meta: PostMeta;
  createdAt: number;
  updatedAt: number;
  /** Repo path this draft was last published to, if any. */
  publishedPath?: string;
  publishedAt?: number;
}

export interface StoredImage {
  id: string;
  name: string;
  type: string;
  blob: Blob;
  addedAt: number;
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
      request.onsuccess = () => resolve(request.result);
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
  });
}

export const draftStore = {
  all: () => tx<Draft[]>(DRAFTS, "readonly", (s) => s.getAll() as IDBRequest<Draft[]>),
  get: (id: string) => tx<Draft | undefined>(DRAFTS, "readonly", (s) => s.get(id) as IDBRequest<Draft | undefined>),
  put: (draft: Draft) => tx(DRAFTS, "readwrite", (s) => s.put(draft) as IDBRequest<IDBValidKey>),
  remove: (id: string) => tx(DRAFTS, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>),
};

export const imageStore = {
  get: (id: string) => tx<StoredImage | undefined>(IMAGES, "readonly", (s) => s.get(id) as IDBRequest<StoredImage | undefined>),
  put: (image: StoredImage) => tx(IMAGES, "readwrite", (s) => s.put(image) as IDBRequest<IDBValidKey>),
  remove: (id: string) => tx(IMAGES, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>),
  all: () => tx<StoredImage[]>(IMAGES, "readonly", (s) => s.getAll() as IDBRequest<StoredImage[]>),
};

/** `local:<id>` srcs point at IndexedDB rather than the network. */
export const LOCAL_PREFIX = "local:";

/** Not a type predicate: narrowing its negative branch would land on `never`. */
export function isLocalSrc(src: string | null | undefined): boolean {
  return typeof src === "string" && src.startsWith(LOCAL_PREFIX);
}

export function localId(src: string): string {
  return src.slice(LOCAL_PREFIX.length);
}

const objectUrls = new Map<string, string>();

/** Resolves a `local:` src to an object URL, caching one URL per image id. */
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
