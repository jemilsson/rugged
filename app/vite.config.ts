import { defineConfig } from "vite";

// @solana/web3.js expects Node's Buffer/global in the browser; polyfill via
// the `buffer` package (imported in main.ts) and point `global` at
// `globalThis` for code that references it directly.
export default defineConfig({
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
});
