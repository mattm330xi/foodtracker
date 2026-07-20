<script lang="ts">
  import { onMount } from 'svelte';

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
        reg.update();
      }).catch(console.error);
    }
  });
</script>

<slot />
