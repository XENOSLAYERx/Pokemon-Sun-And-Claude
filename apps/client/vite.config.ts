import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string): string => resolve(here, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    // Point directly at package sources. There is no build step between the
    // simulation packages and the client, so a change to the AI is live on
    // the next hot reload — which is what makes tuning behaviour tractable.
    alias: {
      '@alola/core': pkg('core'),
      '@alola/data': pkg('data'),
      '@alola/world': pkg('world'),
      '@alola/ai': pkg('ai'),
      '@alola/battle': pkg('battle'),
      '@alola/quest': pkg('quest'),
      '@alola/save': pkg('save'),
      '@alola/net': pkg('net'),
      '@alola/audio': pkg('audio'),
      '@alola/render': pkg('render'),
      '@alola/ui': pkg('ui'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Three is large and changes rarely; keeping it separate means a
          // gameplay patch does not invalidate it in the player's cache.
          three: ['three'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
});
