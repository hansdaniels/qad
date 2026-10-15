/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

// The editor uses the model core's sources directly; no pack step during development.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@qad/model-core': fileURLToPath(new URL('../../packages/model-core/src/index.ts', import.meta.url)),
    },
  },
});
