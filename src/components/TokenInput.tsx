import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Topic } from "../../shared/types.ts";
import { uniqueNames } from "../lib/markdown.ts";
import { findTopic, knownTopic, suggestTopics } from "../lib/topics.ts";

interface TokenInputProps {
  id: string;
  values: string[];
  placeholder?: string;
  suggestions?: Topic[];
  max?: number;
  onChange: (values: string[]) => void;
}

function scroller(element: HTMLElement, overflowing = true): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      (!overflowing || node.scrollHeight > node.clientHeight)
    ) {
      return node;
    }
  }
  return null;
}

function reveal(top: HTMLElement, bottom: HTMLElement) {
  const parent = scroller(top);
  if (!parent) {
    return;
  }
  const frame = parent.getBoundingClientRect();
  const start = top.getBoundingClientRect().top;
  const end = bottom.getBoundingClientRect().bottom;
  if (end - start > frame.height || start < frame.top) {
    parent.scrollTop += start - frame.top - 8;
  } else if (end > frame.bottom) {
    parent.scrollTop += end - frame.bottom + 8;
  }
}

function changed(next: string[], values: string[]): boolean {
  return next.length !== values.length || next.some((value, index) => value !== values[index]);
}

export function TokenInput({ id, values, placeholder, suggestions = [], max = Infinity, onChange }: TokenInputProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const full = values.length >= max;
  const offered = useMemo(
    () => (focused && !dismissed && !full ? suggestTopics(suggestions, draft, values) : []),
    [focused, dismissed, full, suggestions, draft, values],
  );
  const listId = `${id}-suggestions`;
  const open = offered.length > 0;

  useEffect(() => {
    setActive(-1);
  }, [draft, offered.length]);

  useLayoutEffect(() => {
    if (open && box.current && list.current) {
      reveal(box.current, list.current);
    }
  }, [open, draft]);

  useEffect(() => {
    const parent = focused && box.current ? scroller(box.current, false) : null;
    if (!parent) {
      return;
    }
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (box.current) {
          reveal(box.current, list.current ?? box.current);
        }
      });
    });
    observer.observe(parent);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [focused]);

  const commit = (raw: string) => {
    const next = uniqueNames([
      ...values,
      ...raw
        .split(",")
        .map((item) => item.normalize("NFC").trim())
        .filter(Boolean)
        .map((item) => knownTopic(item, suggestions)),
    ]).slice(0, Math.max(max, values.length));
    if (changed(next, values)) {
      onChange(next);
    }
    setDraft("");
  };

  const pick = (topic: Topic) => {
    const next = uniqueNames([...values, topic.slug]).slice(0, Math.max(max, values.length));
    if (changed(next, values)) {
      onChange(next);
    }
    setDraft("");
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, offered.length - 1));
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, -1));
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    } else if (event.key === "Enter" && open && offered[active]) {
      event.preventDefault();
      pick(offered[active]);
    } else if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <>
      <div ref={box} className="tokens" onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          document.getElementById(id)?.focus();
        }
      }}>
        {values.map((value) => {
          const topic = findTopic(value, suggestions);
          const fresh = suggestions.length > 0 && !topic;
          return (
            <span
              key={value}
              className={fresh ? "token is-new" : "token"}
              title={fresh ? "Not one of the blog's topics yet" : undefined}
            >
              {topic?.title ?? value}
              <button
                type="button"
                aria-label={`Remove ${topic?.title ?? value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          id={id}
          className="token-input"
          value={draft}
          placeholder={values.length ? "" : placeholder}
          disabled={full}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            const typed = event.target.value;
            const cut = typed.lastIndexOf(",");
            if (cut !== -1 && !(event.nativeEvent as InputEvent).isComposing) {
              commit(typed.slice(0, cut));
              setDraft(typed.slice(cut + 1).trimStart());
            } else {
              setDraft(typed);
            }
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => {
            setFocused(false);
            commit(draft);
          }}
        />
      </div>
      {open ? (
        <div
          ref={list}
          id={listId}
          className="token-suggestions"
          role="listbox"
          aria-label="Already on the blog"
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
        >
          {offered.map((topic, index) => (
            <button
              key={topic.slug}
              id={`${listId}-${index}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={index === active}
              className={index === active ? "token-suggestion is-active" : "token-suggestion"}
              onClick={() => pick(topic)}
            >
              {topic.title}
              <span className="token-suggestion-count">{topic.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
