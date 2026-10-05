import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import process from "node:process";
import { fileURLToPath } from "node:url";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue()],

  // Vitest 用最小的 DOM 环境跑 Vue 组件测试。
  // 默认测试运行只读：快照 / golden 文件缺失或不一致都失败，只有显式的 `vitest run -u` 才写入。
  test: {
    environment: "happy-dom",
    update: "none",
    // MathLive 在 Node 中解析为没有编辑器的 SSR 版本；测试在 DOM 环境中使用浏览器版本。
    alias: [{ find: /^mathlive$/, replacement: fileURLToPath(new URL("./node_modules/mathlive/mathlive.mjs", import.meta.url)) }],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
