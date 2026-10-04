import { defineConfig } from 'vite';

// Dev: forward /api to the Node server. If it is down, answer 200 {offline:true} so the browser console stays clean.
export default defineConfig({
  build: { chunkSizeWarningLimit: 800, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
        xfwd: true,
        configure(proxy) {
          proxy.on('error', (_err, _req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end('{"offline":true}');
            }
          });
        },
      },
    },
  },
});
