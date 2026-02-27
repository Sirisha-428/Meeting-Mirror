import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'fs';
import path from 'path';

// Use mkcert certs if they exist (no browser warning), else fall back to basic-ssl
const certPath = path.resolve(__dirname, 'certs/localhost.pem');
const keyPath = path.resolve(__dirname, 'certs/localhost-key.pem');
const useMkcert = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig({
  plugins: useMkcert ? [react()] : [react(), basicSsl()],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    port: 3000,
    https: useMkcert
      ? {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        }
      : true,
  },
});
