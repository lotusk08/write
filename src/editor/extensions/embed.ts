import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      /** Inserts one of the blog's `{% include embed/… %}` players. */
      setEmbed: (attributes: { platform: string; id: string }) => ReturnType;
    };
  }
}

/** The players the blog's `_includes/embed` folder can render. */
export const PLATFORMS = ["youtube", "x", "bilibili", "spotify", "twitch", "audio", "video"] as const;

/** `{% include embed/youtube.html id='w40oCqXw-5k' %}` */
export const EMBED_LIQUID =
  /^\{%\s*include\s+embed\/([a-z]+)\.html\s+id=(["'])([^"']+)\2\s*%\}$/;

export function embedLiquid(platform: string, id: string, quote = "'"): string {
  return `{% include embed/${platform}.html id=${quote}${id}${quote} %}`;
}

/**
 * Reads an id out of a page URL, so a link can be pasted instead of hunting
 * for the id. Returns null for anything not recognised.
 */
export function embedFromUrl(value: string): { platform: string; id: string } | null {
  const url = value.trim();
  const youtube =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (youtube) {
    return { platform: "youtube", id: youtube[1] };
  }
  const x = /(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/.exec(url);
  if (x) {
    return { platform: "x", id: x[1] };
  }
  const bilibili = /bilibili\.com\/video\/([\w-]+)/.exec(url);
  if (bilibili) {
    return { platform: "bilibili", id: bilibili[1] };
  }
  // The blog's include builds `/embed/track/<id>` itself, so it takes the
  // bare id and handles tracks only.
  const spotify = /spotify\.com\/(?:embed\/)?track\/(\w+)/.exec(url);
  if (spotify) {
    return { platform: "spotify", id: spotify[1] };
  }
  const twitch = /twitch\.tv\/videos\/(\d+)/.exec(url);
  if (twitch) {
    return { platform: "twitch", id: twitch[1] };
  }
  // A bare id, which is what the include itself takes.
  return /^[\w-]{6,}$/.test(url) ? { platform: "youtube", id: url } : null;
}

/** Where an embed can be opened, for the platforms without a player here. */
function externalUrl(platform: string, id: string): string {
  switch (platform) {
    case "x":
      return `https://x.com/i/status/${id}`;
    case "bilibili":
      return `https://www.bilibili.com/video/${id}`;
    case "spotify":
      return `https://open.spotify.com/track/${id}`;
    case "twitch":
      return `https://www.twitch.tv/videos/${id}`;
    default:
      return id;
  }
}

/**
 * The blog embeds players with a Liquid include rather than with Markdown, so
 * this node holds the platform and id and writes that include back out. A
 * YouTube video plays in place; the rest show a card that opens the original,
 * which is as far as an editor needs to go.
 */
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      platform: { default: "youtube" },
      id: { default: "" },
      /** The quote the include was written with, kept so editing a post does
       *  not rewrite lines it did not touch. */
      quote: { default: "'" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-embed": "" })];
  },

  addCommands() {
    return {
      setEmbed:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: attributes }),
    };
  },

  addNodeView() {
    return ({ node }): NodeView => {
      const platform = String(node.attrs.platform ?? "youtube");
      const id = String(node.attrs.id ?? "");

      const dom = document.createElement("div");
      dom.className = "embed-block";
      dom.dataset.platform = platform;
      dom.contentEditable = "false";

      if (platform === "youtube") {
        const frame = document.createElement("iframe");
        // The no-cookie host, since this is only a preview while writing.
        frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
        frame.title = "YouTube video player";
        frame.loading = "lazy";
        frame.allow = "accelerometer; encrypted-media; picture-in-picture";
        frame.allowFullscreen = true;
        dom.append(frame);
      } else {
        const card = document.createElement("a");
        card.className = "embed-card";
        card.href = externalUrl(platform, id);
        card.target = "_blank";
        card.rel = "noreferrer noopener";
        card.textContent = `${platform} · ${id}`;
        dom.append(card);
      }

      const caption = document.createElement("span");
      caption.className = "embed-note";
      caption.textContent = embedLiquid(platform, id, String(node.attrs.quote ?? "'"));
      dom.append(caption);

      return { dom, ignoreMutation: () => true };
    };
  },
});
