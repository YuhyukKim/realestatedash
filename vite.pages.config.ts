import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "pages",
  base: "/realestatedash/",
  publicDir: "public",
  plugins: [react()],
  define: { __GITHUB_PAGES__: "true" },
  build: { outDir: "../dist-pages", emptyOutDir: true, sourcemap: false },
});
