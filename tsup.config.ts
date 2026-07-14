import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: {
    "main/index": path.join(currentDirectory, "src/main/index.ts"),
    "preload/index": path.join(currentDirectory, "src/preload/index.ts"),
  },
  clean: true,
  dts: false,
  format: ["cjs"],
  outDir: "dist-electron",
  outExtension: () => ({ js: ".cjs" }),
  platform: "node",
  sourcemap: true,
  splitting: false,
  external: [/^electron($|\/)/],
});
