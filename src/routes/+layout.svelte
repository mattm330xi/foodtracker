<script lang="ts">
  import { onMount } from 'svelte';
  import PwaInstallBanner from '$lib/PwaInstallBanner.svelte';
  import '../app.css';

  onMount(() => {
    const savedTheme = localStorage.getItem('ft_theme') as 'light' | 'dark' | 'system' | null;
    if (savedTheme) {
      if (savedTheme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      } else {
        document.documentElement.setAttribute('data-theme', savedTheme);
      }
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
        reg.update();
      }).catch(console.error);
    }
  });
</script>

<slot />
<PwaInstallBanner />
