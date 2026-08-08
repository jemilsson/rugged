import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Multi-entry build: main app (index.html) plus the standalone board prototype (board.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
});
