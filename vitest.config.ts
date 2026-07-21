import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
