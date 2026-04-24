import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Vite only bundles `index.html` assets; copy MV3 files into `build/` for unpacked load. */
function copyExtensionStaticFiles() {
  return {
    name: 'copy-extension-static',
    closeBundle() {
      const extRoot = path.resolve(__dirname, 'extension');
      const outDir = path.resolve(extRoot, 'build');
      for (const f of ['manifest.json', 'content.js', 'background.js']) {
        fs.copyFileSync(path.join(extRoot, f), path.join(outDir, f));
      }
    },
  };
}

/**
 * Build config for the Chrome extension (Google Meet).
 * Output goes to extension/build/ for loading in the side panel.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'extension'),
  plugins: [react(), copyExtensionStaticFiles()],
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
