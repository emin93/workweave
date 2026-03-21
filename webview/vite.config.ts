import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: resolve(__dirname, "src/main.tsx"),
      output: {
        entryFileNames: "index.js",
        assetFileNames: "index.[ext]",
      },
    },
    cssCodeSplit: false,
    sourcemap: true,
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
