import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // 产物直接进站点根目录下的 app/，沿用现有 Cloudflare Workers 静态资源链路
  base: "/app/",
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
