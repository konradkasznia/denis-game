import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5180,
    strictPort: false,
    host: true,
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
