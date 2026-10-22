import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Android WebViews used by some in-app browsers (e.g. older Eitaa clients)
      // do not support ES modules or modern syntax. The legacy plugin emits a
      // `nomodule` fallback bundle so the app still boots there instead of
      // showing a blank page.
      legacy({
        targets: ['defaults', 'chrome >= 49', 'android >= 5', 'ios >= 10', 'safari >= 10'],
        renderLegacyChunks: true,
        modernPolyfills: true,
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
