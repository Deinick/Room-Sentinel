import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      // pnpm's project links can point back into this checkout.
      ignored: ['**/.pnpm-store/**'],
      followSymlinks: false,
    },
  },
  optimizeDeps: { entries: ['index.html'] },
});
