import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// dev: vite on :5173 proxies /mcp to the server on :3000. prod: the server serves the build.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/mcp': 'http://localhost:3000',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
