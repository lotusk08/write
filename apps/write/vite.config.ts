import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Cloudflare plugin runs `worker/index.ts` inside workerd during `vite dev`,
// so the /api routes behave locally exactly as they do once deployed.
// The DOCX exporter is imported dynamically in the app, so Vite already keeps
// that (heavy) dependency out of the initial bundle.
export default defineConfig({
  plugins: [react(), cloudflare()],
});
