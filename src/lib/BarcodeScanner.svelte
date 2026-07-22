<script lang="ts">
  import { onDestroy } from 'svelte';

  interface Props {
    elementId?: string;
    onBarcode?: (code: string) => void;
  }

  let { elementId = 'barcode-reader', ...restProps }: Props = $props();
  let onBarcode = $derived(restProps.onBarcode);

  let isScanning = $state(false);
  let cameraError = $state<string | null>(null);
  let isTransitioning = false;
  let scanCooldown = false;

  let stream: MediaStream | null = null;
  let rafId = 0;
  let detector: BarcodeDetector | null = null;
  let lastCode = '';
  let lastCodeTime = 0;

  const FOOD_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8'] as const;

  async function scanFrame() {
    if (!detector || !stream) return;
    rafId = requestAnimationFrame(scanFrame);

    const video = document.getElementById(elementId) as HTMLVideoElement;
    if (!video || video.readyState < 2) return;

    try {
      const barcodes = await detector.detect(video);
      for (const barcode of barcodes) {
        const code = barcode.rawValue;
        if (!code) continue;

        const now = Date.now();
        if (code === lastCode && now - lastCodeTime < 3000) continue;
        if (scanCooldown) continue;

        lastCode = code;
        lastCodeTime = now;
        scanCooldown = true;
        setTimeout(() => { scanCooldown = false; }, 2000);

        try {
          onBarcode?.(code);
        } catch (e) {
          console.error('[Scanner] onBarcode threw:', e);
        }
        break;
      }
    } catch {
      // detect() can throw on transient frame errors — ignore
    }
  }

  async function startScanner() {
    if (isTransitioning || stream) return;
    isTransitioning = true;
    scanCooldown = false;
    cameraError = null;
    lastCode = '';
    lastCodeTime = 0;

    try {
      if (typeof BarcodeDetector === 'undefined') {
        cameraError = 'BarcodeDetector not supported in this browser. Try Chrome or Safari 15.4+.';
        return;
      }

      const supported = await BarcodeDetector.getSupportedFormats();
      const wanted = [...FOOD_FORMATS];
      const formats = wanted.filter((f) => supported.includes(f));
      if (formats.length === 0) {
        cameraError = 'No supported food barcode formats.';
        return;
      }

      detector = new BarcodeDetector({ formats });

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });

      const video = document.getElementById(elementId) as HTMLVideoElement;
      if (!video) return;

      video.srcObject = stream;
      await video.play();
      isScanning = true;
      scanFrame();
    } catch (e: any) {
      cameraError = e?.name === 'NotAllowedError'
        ? 'Camera permission denied.'
        : e?.message || 'Camera access failed.';
      stopScanner();
    } finally {
      isTransitioning = false;
    }
  }

  function stopScanner() {
    if (isTransitioning && !stream) return;
    isTransitioning = true;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    const video = document.getElementById(elementId) as HTMLVideoElement;
    if (video) video.srcObject = null;

    detector = null;
    isScanning = false;
    isTransitioning = false;
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) stream.getTracks().forEach((t) => t.stop());
  });

  export { startScanner, stopScanner };
</script>

<div class="barcode-viewport">
  <video id={elementId} class="barcode-video" playsinline muted></video>
  {#if isScanning}
    <div class="scan-frame">
      <span class="corner tl"></span><span class="corner tr"></span>
      <span class="corner bl"></span><span class="corner br"></span>
      <span class="scan-line"></span>
    </div>
  {/if}
</div>
{#if isScanning}<span data-testid="scanning">Scanning</span>{/if}
{#if cameraError}<span data-testid="result">{cameraError}</span>{/if}

<style>
  .barcode-viewport {
    position: relative;
    width: 100%;
    border-radius: var(--radius-md, 12px);
    overflow: hidden;
    background: #000;
  }
  .barcode-video {
    width: 100%;
    max-width: 100%;
    display: block;
  }
  .scan-frame {
    position: absolute;
    inset: 14% 8%;
    pointer-events: none;
  }
  .corner {
    position: absolute;
    width: 22px;
    height: 22px;
    border: 3px solid var(--primary, #34C759);
  }
  .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; border-radius: 6px 0 0 0; }
  .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; border-radius: 0 6px 0 0; }
  .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; border-radius: 0 0 0 6px; }
  .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; border-radius: 0 0 6px 0; }
  .scan-line {
    position: absolute;
    left: 2%;
    right: 2%;
    height: 2px;
    background: var(--primary, #34C759);
    box-shadow: 0 0 8px 1px var(--primary, #34C759);
    animation: scan-sweep 1.8s ease-in-out infinite;
  }
  @keyframes scan-sweep {
    0%, 100% { top: 4%; opacity: 0.9; }
    50% { top: 92%; opacity: 0.9; }
  }
</style>
