import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:2567',
      '/realtime': {
        target: 'ws://localhost:2567',
        ws: true,
        rewrite: (path) => path.replace(/^\/realtime/, ''),
      },
    },
  },
});
