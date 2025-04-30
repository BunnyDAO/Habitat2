import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@blockworks-foundation/mango-client"], // Skip pre-bundling
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'service-worker': resolve(__dirname, 'src/service-worker.ts'),
      },
      output: {
        entryFileNames: (assetInfo) => {
          return assetInfo.name === 'service-worker' ? '[name].js' : 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        headers: {
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=5'
        },
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Sending Request to the Target:', {
              method: req.method,
              url: req.url,
              headers: req.headers
            });
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Received Response from the Target:', {
              statusCode: proxyRes.statusCode,
              url: req.url,
              headers: proxyRes.headers
            });
          });
        },
      },
    },
  },
});
