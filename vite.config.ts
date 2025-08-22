import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // Environment-specific configuration
  const isDevelopment = mode === 'development';
  const isStaging = mode === 'staging';
  const isProduction = mode === 'production';
  
  console.log(`🚀 Building for ${mode} environment`);
  
  return {
    plugins: [react()],
    define: {
      __APP_ENV__: JSON.stringify(mode),
      __IS_DEV__: JSON.stringify(isDevelopment),
      __IS_STAGING__: JSON.stringify(isStaging),
      __IS_PROD__: JSON.stringify(isProduction),
    },
    optimizeDeps: {
      exclude: ["@blockworks-foundation/mango-client"], // Skip pre-bundling
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
        },
      },
      // Environment-specific build optimizations
      minify: isProduction ? 'terser' : false,
      sourcemap: !isProduction,
    },
    server: {
      // Development proxy configuration
      proxy: isDevelopment ? {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        '/config.json': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        }
      } : undefined,
      // Environment-specific server settings
      port: isDevelopment ? 5173 : 3000,
      host: isDevelopment ? 'localhost' : '0.0.0.0',
    },
    // Environment-specific public directory
    publicDir: 'public',
    
    // Environment variables
    envPrefix: ['VITE_', 'APP_'],
    
    // Logging
    logLevel: isDevelopment ? 'info' : 'warn',
  };
});
