import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const packages = resolve(here, '../../packages');

export default defineConfig({
  resolve: {
    // Point directly at package sources. There is no build step between the
    // simulation packages and the client, so a change to the AI is live on
    // the next hot reload — which is what makes tuning behaviour tractable.
    //
    // Two rules rather than one alias per package: `@alola/x` resolves to the
    // package's index, and `@alola/x/some/file.ts` to that file. The second
    // form is what lets the terrain worker import the Three-free mesher alone
    // instead of the whole render package, Three.js included. It also means a
    // new package cannot be forgotten here — which is how `@alola/game` came
    // to be resolved through a node_modules symlink instead of this map.
    alias: [
      { find: /^@alola\/([a-z]+)$/, replacement: `${packages}/$1/src/index.ts` },
      { find: /^@alola\/([a-z]+)\/(.+)$/, replacement: `${packages}/$1/src/$2` },
    ],
  },
  worker: {
    // Module workers, so a worker can share chunks with the main bundle.
    format: 'es',
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
