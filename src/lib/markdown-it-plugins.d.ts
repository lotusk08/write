declare module "markdown-it-deflist" {
  import type { MarkdownIt } from "markdown-it";

  const deflist: (md: MarkdownIt) => void;
  export default deflist;
}
