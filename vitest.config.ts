import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@shared': resolve(import.meta.dirname, 'rayfin/functions/src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'rayfin/functions/src/**/*.{test,spec}.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', '**/dist/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
