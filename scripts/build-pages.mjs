import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir(".cache", { recursive: true });
await build({
  entryPoints: ["scripts/pages-data.ts"], outfile: ".cache/pages-data.mjs",
  bundle: true, platform: "node", format: "esm", target: "node22",
});
const { generatePagesData } = await import("../.cache/pages-data.mjs");
await generatePagesData();
