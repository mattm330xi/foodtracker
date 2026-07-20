import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: 'include',
      pages: 'build',
      assets: 'build',
      fallback: undefined,
      precompress: false,
      static: 'static'
    })
  }
};

export default config;
