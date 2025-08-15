import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // plugins: [react()], // Disabled to fix ESM issue
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '*.config.ts',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/index.ts',
      ],
    },
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});