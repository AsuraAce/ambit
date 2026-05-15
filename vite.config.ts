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
      rolldownOptions: {
        output: {
          codeSplitting: {
            minSize: 20_000,
            groups: [
              {
                name: 'react-vendor',
                test: /node_modules[\\/]\.pnpm[\\/](react|react-dom|scheduler)@/,
                priority: 30,
              },
              {
                name: 'state-vendor',
                test: /node_modules[\\/]\.pnpm[\\/](@tanstack[+]react-query|zustand)@/,
                priority: 25,
              },
              {
                name: 'ui-vendor',
                test: /node_modules[\\/]\.pnpm[\\/](framer-motion|lucide-react)@/,
                priority: 20,
                maxSize: 250_000,
              },
              {
                name: 'tauri-vendor',
                test: /node_modules[\\/]\.pnpm[\\/]@tauri-apps[+\\/]/,
                priority: 20,
              },
              {
                name: 'app-data-core',
                test: /[\\/]src[\\/](bindings\.ts|services[\\/]db[\\/]|utils[\\/]sqlHelpers\.ts)/,
                priority: 10,
                maxSize: 250_000,
              },
              {
                name: 'vendor',
                test: /node_modules[\\/]/,
                priority: 1,
                maxSize: 250_000,
              },
            ],
          },
        },
      },
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
