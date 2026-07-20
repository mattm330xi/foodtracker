<script lang="ts">
  import { onMount } from 'svelte';

  let entries: Array<{ id: number; text: string; image: string; created_at: string }> = $state([]);
  let text = $state('');
  let imageBase64 = $state('');
  let recording = $state(false);
  let cameraInput: HTMLInputElement;
  let recognition: any = null;

  onMount(async () => {
    const res = await fetch('/api/entries');
    entries = await res.json();
  });

  function compressImage(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 800;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = (h / w) * MAX; w = MAX; }
            else { w = (w / h) * MAX; h = MAX; }
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    imageBase64 = await compressImage(file);
  }

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition not supported'); return; }
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e: any) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      text = t;
    };
    recognition.onerror = () => { recording = false; };
    recognition.onend = () => { recording = false; };
    recognition.start();
    recording = true;
  }

  function stopVoice() {
    recognition?.stop();
    recording = false;
  }

  async function addEntry() {
    if (!text && !imageBase64) return;
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image: imageBase64 })
    });
    const { id } = await res.json();
    entries = [{ id, text, image: imageBase64, created_at: new Date().toISOString() }, ...entries];
    text = '';
    imageBase64 = '';
  }
</script>

<svelte:head>
  <title>Food Tracker</title>
</svelte:head>

<main>
  <h1>Food Tracker</h1>

  <div class="actions">
    <button onclick={() => cameraInput.click()}>📷 Photo</button>
    <input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={handlePhoto} hidden />
    <button class:active={recording} onclick={recording ? stopVoice : startVoice}>
      {recording ? '⏹ Stop' : '🎤 Voice'}
    </button>
  </div>

  {#if imageBase64}
    <img src={imageBase64} alt="Preview" class="preview" />
  {/if}

  <textarea bind:value={text} placeholder="Notes..." rows="3"></textarea>

  <button class="submit" onclick={addEntry}>Add Entry</button>

  <div class="entries">
    {#each entries as entry (entry.id)}
      <div class="entry">
        <small>{new Date(entry.created_at).toLocaleString()}</small>
        {#if entry.image}
          <img src={entry.image} alt="Food" class="entry-img" />
        {/if}
        {#if entry.text}
          <p>{entry.text}</p>
        {/if}
      </div>
    {/each}
  </div>
</main>

<style>
  main { max-width: 480px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0 0 16px; }
  .actions { display: flex; gap: 8px; margin-bottom: 12px; }
  button { padding: 10px 16px; border-radius: 8px; border: 1px solid #ccc; background: #f5f5f5; cursor: pointer; font-size: 14px; }
  button.active { background: #c00; color: #fff; }
  .preview { width: 100%; border-radius: 8px; margin-bottom: 8px; }
  textarea { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #ccc; box-sizing: border-box; margin-bottom: 8px; font-family: inherit; }
  .submit { width: 100%; background: #000; color: #fff; }
  .entries { margin-top: 24px; }
  .entry { border: 1px solid #eee; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .entry small { color: #888; }
  .entry-img { width: 100%; border-radius: 8px; margin-top: 8px; }
  .entry p { margin: 8px 0 0; }
</style>
