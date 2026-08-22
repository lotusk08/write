import { useEffect, useState } from "react";
import type { PostMeta } from "../../../shared/types.ts";
import { isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";

export interface PostPanelProps {
  meta: PostMeta;
  slug: string;
  onChange: (patch: Partial<PostMeta>) => void;
  onSlugChange: (slug: string) => void;
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function PostPanel({ meta, slug, onChange, onSlugChange }: PostPanelProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    const path = meta.cover?.path;
    if (!path) {
      setCoverUrl(null);
      return;
    }
    if (isLocalSrc(path)) {
      void resolveLocalSrc(path).then(setCoverUrl);
    } else {
      setCoverUrl(path);
    }
  }, [meta.cover?.path]);

  return (
    <>
      <div className="field">
        <label htmlFor="meta-slug">Slug</label>
        <input
          id="meta-slug"
          className="input"
          value={slug}
          onChange={(event) => onSlugChange(event.target.value)}
        />
        <p className="hint">Used for the file name and image names.</p>
      </div>

      <div className="field">
        <label htmlFor="meta-date">Date</label>
        <input
          id="meta-date"
          className="input"
          value={meta.date}
          onChange={(event) => onChange({ date: event.target.value })}
        />
        <p className="hint">Front matter format, e.g. 2026-08-22 09:30:00 +0700.</p>
      </div>

      <div className="field">
        <label htmlFor="meta-author">Author</label>
        <input
          id="meta-author"
          className="input"
          value={meta.author}
          onChange={(event) => onChange({ author: event.target.value })}
        />
      </div>

      <div className="field">
        <label htmlFor="meta-categories">Categories</label>
        <input
          id="meta-categories"
          className="input"
          value={meta.categories.join(", ")}
          placeholder="Vietnamese, Essays"
          onChange={(event) => onChange({ categories: parseList(event.target.value) })}
        />
      </div>

      <div className="field">
        <label htmlFor="meta-tags">Tags</label>
        <input
          id="meta-tags"
          className="input"
          value={meta.tags.join(", ")}
          placeholder="coffee, experience"
          onChange={(event) => onChange({ tags: parseList(event.target.value) })}
        />
      </div>

      <div className="field post-cover">
        <span className="field-label">Cover image</span>
        {coverUrl ? <img className="cover-preview" src={coverUrl} alt={meta.cover?.alt ?? ""} /> : null}
        <input
          className="input"
          type="file"
          accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) {
              return;
            }
            const stored = await storeImageFile(file);
            onChange({ cover: { path: `local:${stored.id}`, alt: meta.cover?.alt ?? "" } });
          }}
        />
        {meta.cover ? (
          <>
            <input
              className="input"
              placeholder="Cover alt text"
              value={meta.cover.alt}
              onChange={(event) =>
                onChange({ cover: { path: meta.cover?.path ?? "", alt: event.target.value } })
              }
            />
            <button type="button" className="btn ghost danger" onClick={() => onChange({ cover: null })}>
              Remove cover
            </button>
          </>
        ) : null}
      </div>

      <div className="field">
        <span className="field-label">Options</span>
        <label className="switch">
          <input type="checkbox" checked={meta.toc} onChange={(event) => onChange({ toc: event.target.checked })} />
          Table of contents
        </label>
        <label className="switch">
          <input type="checkbox" checked={meta.pin} onChange={(event) => onChange({ pin: event.target.checked })} />
          Pin to home
        </label>
        <label className="switch">
          <input type="checkbox" checked={meta.math} onChange={(event) => onChange({ math: event.target.checked })} />
          Math (KaTeX)
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={meta.mermaid}
            onChange={(event) => onChange({ mermaid: event.target.checked })}
          />
          Mermaid diagrams
        </label>
      </div>
    </>
  );
}
