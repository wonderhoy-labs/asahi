import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { asahi } from './plugins/asahi.ts';

export default defineConfig({
  // Relative, so that a copy of the site works from any address.
  base: './',
  plugins: [react(), asahi()],
  // The page carries the desktop's start script, which lives with the app.
  server: { fs: { allow: ['..'] } },
  build: { target: 'es2023', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'plugins/**/*.test.ts'] },
});
