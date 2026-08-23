import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Nothing but static files come out of this: the app talks to GitHub from the
// browser, so there is no server side to run alongside `vite dev`.
// The DOCX exporter is imported dynamically in the app, so Vite already keeps
// that (heavy) dependency out of the initial bundle.
export default defineConfig({
  plugins: [react()],
});
