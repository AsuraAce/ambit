import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig as defineConfigVitest } from 'vitest/config';


export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 1422,
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [react()],
    build: {
      modulePreload: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            minSize: 20_000,
            groups: [
              {
                name: 'react-runtime',
                test: /node_modules[\\/]\.pnpm[\\/](react|react-dom|scheduler)@/,
                priority: 30,
              },
              {
                name: 'app-runtime',
                test: /node_modules[\\/]\.pnpm[\\/](@tanstack[+]react-query|zustand|framer-motion)@/,
                priority: 20,
              },
              {
                name: 'ui-icons',
                test: /node_modules[\\/]\.pnpm[\\/]lucide-react@/,
                priority: 10,
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
      coverage: {
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/bindings.ts',
          'src/**/*.test.{ts,tsx}',
          'src/**/__tests__/**',
          'src/test/**',
        ],
      },
    }
  };
});
