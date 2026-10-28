declare module "markdown-it-footnote" {
  import type { MarkdownIt } from "markdown-it";

  const footnote: (md: MarkdownIt) => void;
  export default footnote;
}

declare module "markdown-it-deflist" {
  import type { MarkdownIt } from "markdown-it";

  const deflist: (md: MarkdownIt) => void;
  export default deflist;
}
