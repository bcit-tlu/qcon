import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig(({ mode }) => {
  const compact = mode === "compact";
  return {
    plugins: [react(), ...(compact ? [viteSingleFile()] : [])],
    base: compact ? "./" : (process.env.VITE_BASE ?? "/"),
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      outDir: compact ? "dist/compact" : "dist",
    },
    test: {
      environment: "node",
      setupFiles: ["src/test-setup.ts"],
    },
    preview: {
      port: 9000,
      host: true,
    },
  };
});
