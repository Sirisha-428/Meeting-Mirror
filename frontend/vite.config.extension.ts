import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Build config for the Chrome extension (Google Meet).
 * Output goes to extension/build/ for loading in the side panel.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'extension'),
  plugins: [react()],
  base: './',
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    outDir: 'build',
    emptyDirOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'extension/index.html'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
