import { useEffect, useRef, useState } from "react";
import type { PostMeta } from "../../../shared/types.ts";
import { isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import { displaySrc } from "../../lib/site.ts";
import { TokenInput } from "../TokenInput.tsx";
import { Section } from "./Section.tsx";

export interface PostPanelProps {
  meta: PostMeta;
  slug: string;
  onChange: (patch: Partial<PostMeta>) => void;
  onSlugChange: (slug: string) => void;
}

const OPTIONS: { key: "toc" | "pin" | "math" | "mermaid" | "chart"; label: string; hint: string }[] = [
  { key: "toc", label: "Table of contents", hint: "Sidebar outline on the post page" },
  { key: "pin", label: "Pin to home", hint: "Keeps the post at the top of the index" },
  { key: "math", label: "Math", hint: "Loads KaTeX for this post" },
  { key: "mermaid", label: "Diagrams", hint: "Loads Mermaid for this post" },
  { key: "chart", label: "Charts", hint: "Loads Chart.js for this post" },
];

export function PostPanel({ meta, slug, onChange, onSlugChange }: PostPanelProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const path = meta.cover?.path;
    if (!path) {
      setCoverUrl(null);
      return;
    }
    if (isLocalSrc(path)) {
      void resolveLocalSrc(path).then(setCoverUrl);
    } else {
      setCoverUrl(displaySrc(path));
    }
  }, [meta.cover?.path]);

  const pickCover = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const stored = await storeImageFile(file);
    onChange({ cover: { path: `local:${stored.id}`, alt: meta.cover?.alt ?? "" } });
  };

  return (
    <>
      <Section title="Taxonomy" hint="Comma or Enter adds one.">
        <div className="field">
          <label htmlFor="meta-categories">Categories</label>
          <TokenInput
            id="meta-categories"
            values={meta.categories}
            placeholder="Vietnamese"
            onChange={(categories) => onChange({ categories })}
          />
        </div>
        <div className="field">
          <label htmlFor="meta-tags">Tags</label>
          <TokenInput
            id="meta-tags"
            values={meta.tags}
            placeholder="coffee, morning"
            onChange={(tags) => onChange({ tags })}
          />
        </div>
      </Section>

      <Section title="Cover image">
        <div className="field post-cover">
          {coverUrl ? (
            <figure className="cover-card">
              <img src={coverUrl} alt={meta.cover?.alt ?? ""} />
              <figcaption>
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() => coverInput.current?.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn tiny danger"
                  onClick={() => onChange({ cover: null })}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          ) : (
            <button
              type="button"
              className="cover-empty"
              onClick={() => coverInput.current?.click()}
            >
              Choose an image
            </button>
          )}
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void pickCover(file);
            }}
          />
          {meta.cover ? (
            <>
              <label htmlFor="meta-cover-alt">Alt text</label>
              <input
                id="meta-cover-alt"
                className="input"
                placeholder="Describes the image"
                value={meta.cover.alt}
                onChange={(event) =>
                  onChange({ cover: { path: meta.cover?.path ?? "", alt: event.target.value } })
                }
              />
            </>
          ) : null}
        </div>
      </Section>

      <Section title="Post file">
        <div className="field">
          <label htmlFor="meta-slug">Slug</label>
          <input
            id="meta-slug"
            className="input"
            value={slug}
            onChange={(event) => onSlugChange(event.target.value)}
          />
          <p className="hint">Names the Markdown file and its images.</p>
        </div>
        <div className="field">
          <label htmlFor="meta-date">Date</label>
          <input
            id="meta-date"
            className="input mono"
            value={meta.date}
            onChange={(event) => onChange({ date: event.target.value })}
          />
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
      </Section>

      <Section title="Options">
        <ul className="switch-list">
          {OPTIONS.map(({ key, label, hint }) => (
            <li key={key}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={meta[key]}
                  onChange={(event) =>
                    onChange({ [key]: event.target.checked } as Partial<PostMeta>)
                  }
                />
                <span>
                  {label}
                  <em>{hint}</em>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
