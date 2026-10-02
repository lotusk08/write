import { useEffect, useRef, useState } from "react";
import type { AppConfig, PostMeta, Topics } from "../../../shared/types.ts";
import { fetchTopics } from "../../lib/api.ts";
import { isLocalSrc, resolveLocalSrc, storeImageFile } from "../../lib/db.ts";
import type { Language } from "../../lib/draft.ts";
import type { Settings } from "../../lib/settings.ts";
import { displaySrc } from "../../lib/site.ts";
import { rememberValue, tidyEdited } from "../../lib/text.ts";
import { Toggle, type ToggleOption } from "../Toggle.tsx";
import { TokenInput } from "../TokenInput.tsx";
import { Section } from "./Section.tsx";

export interface PostPanelProps {
  meta: PostMeta;
  slug: string;
  settings: Settings;
  config: AppConfig | null;
  onChange: (patch: Partial<PostMeta>) => void;
  onSlugChange: (slug: string) => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
}

const TARGETS: ToggleOption<Settings["publishTarget"]>[] = [
  { id: "posts", label: "Post" },
  { id: "drafts", label: "Draft" },
];

const LANGUAGES: ToggleOption<Language>[] = [
  { id: "vi", label: "Tiếng Việt" },
  { id: "en", label: "English" },
];

const MAX_TOPICS = 8;

const OPTIONS: { key: "toc" | "pin"; label: string }[] = [
  { key: "toc", label: "Table of contents" },
  { key: "pin", label: "Pin to home" },
];

export function PostPanel({
  meta,
  slug,
  settings,
  config,
  onChange,
  onSlugChange,
  onSettingsChange,
}: PostPanelProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [topics, setTopics] = useState<Topics | null>(null);

  useEffect(() => {
    let live = true;
    void fetchTopics().then((found) => {
      if (live) {
        setTopics(found);
      }
    });
    return () => {
      live = false;
    };
  }, []);

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
      <Section title="Taxonomy">
        <div className="field">
          <label htmlFor="meta-tags">Topics</label>
          <TokenInput
            id="meta-tags"
            values={meta.tags}
            placeholder="coffee, travel"
            suggestions={topics?.tags}
            max={MAX_TOPICS}
            onChange={(tags) => onChange({ tags })}
          />
        </div>
        <div className="menu-row">
          <span className="field-label">Language</span>
          <Toggle label="Language" options={LANGUAGES} value={meta.lang} onChange={(lang) => onChange({ lang })} />
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
                  onChange({
                    cover: { ...meta.cover, path: meta.cover?.path ?? "", alt: event.target.value },
                  })
                }
                onFocus={(event) => rememberValue(event.currentTarget)}
                onBlur={(event) => {
                  const alt = tidyEdited(event.currentTarget);
                  if (alt !== null) {
                    onChange({ cover: { ...meta.cover, path: meta.cover?.path ?? "", alt } });
                  }
                }}
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
      </Section>

      <Section title="Options">
        <ul className="switch-list">
          {OPTIONS.map(({ key, label }) => (
            <li key={key}>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={meta[key]}
                  onChange={(event) =>
                    onChange({ [key]: event.target.checked } as Partial<PostMeta>)
                  }
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Blog">
        {config?.problem ? <div className="notice warn">{config.problem}</div> : null}
        {config ? (
          <>
            <div className="menu-row">
              <span className="field-label">Repository</span>
              <span className="menu-value mono">{config.repo || "\u2014"}</span>
            </div>
            <div className="menu-row">
              <span className="field-label">Branch</span>
              <span className="menu-value mono">{config.branch}</span>
            </div>
            <div className="menu-row">
              <span className="field-label">Publish as</span>
              <Toggle
                label="Publish as"
                options={TARGETS}
                value={settings.publishTarget}
                onChange={(publishTarget) => onSettingsChange({ publishTarget })}
              />
            </div>
          </>
        ) : (
          <p className="hint">
            This app's own API did not answer, so it does not know where it publishes. Reload; if
            that lasts, the Worker is not up.
          </p>
        )}
      </Section>
    </>
  );
}
