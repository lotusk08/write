import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: (attributes: { platform: string; id: string }) => ReturnType;
    };
  }
}

export const PLATFORMS = ["youtube", "x", "bilibili", "spotify", "twitch", "audio", "video"] as const;

export const EMBED_LIQUID =
  /^\{%\s*include\s+embed\/([a-z]+)\.html\s+id=(["'])([^"']+)\2\s*%\}$/;

export function embedLiquid(platform: string, id: string, quote = "'"): string {
  return `{% include embed/${platform}.html id=${quote}${id}${quote} %}`;
}

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
  const spotify = /spotify\.com\/(?:embed\/)?track\/(\w+)/.exec(url);
  if (spotify) {
    return { platform: "spotify", id: spotify[1] };
  }
  const twitch = /twitch\.tv\/videos\/(\d+)/.exec(url);
  if (twitch) {
    return { platform: "twitch", id: twitch[1] };
  }
  return /^[\w-]{6,}$/.test(url) ? { platform: "youtube", id: url } : null;
}

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
