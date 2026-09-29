import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import { initializeBackend, app } from './server/index.js';

const weexBackendPlugin = (): Plugin => ({
  name: 'weex-backend-plugin',
  configureServer(server) {
    if (server.httpServer) {
      initializeBackend(server.httpServer as any);
    }
    server.middlewares.use(app);
  },
});

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), weexBackendPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
