import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig as defineConfigVitest } from 'vitest/config';


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 1421,
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [react()],
    build: {
      modulePreload: false,
    },
    define: {
      'process.env.API_KEY': mode === 'development' ? JSON.stringify(env.GEMINI_API_KEY) : undefined,
      'process.env.GEMINI_API_KEY': mode === 'development' ? JSON.stringify(env.GEMINI_API_KEY) : undefined
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    }
  };
});
