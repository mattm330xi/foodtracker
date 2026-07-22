<script lang="ts">
  import { onMount } from 'svelte';
  import { isStandalone, isDismissed, markDismissed, detectPlatform } from '$lib/pwaInstall';

  let deferredPrompt: any = $state(null);
  let showBanner = $state(false);
  let bannerType: 'android' | 'ios' | null = $state(null);
  let swipeOffset = $state(0);
  let isDragging = $state(false);
  let touchStartX = $state(0);

  function dismiss() {
    markDismissed();
    showBanner = false;
    swipeOffset = 0;
  }

  function handleSwipeEnd() {
    if (Math.abs(swipeOffset) > 100) {
      dismiss();
    } else {
      swipeOffset = 0;
    }
    isDragging = false;
  }

  function onTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    isDragging = true;
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging) return;
    swipeOffset = e.touches[0].clientX - touchStartX;
  }

  function onTouchEnd() {
    handleSwipeEnd();
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      markDismissed();
    }
    deferredPrompt = null;
    showBanner = false;
  }

  onMount(() => {
    if (isStandalone()) return;
    if (isDismissed()) return;

    const platform = detectPlatform();
    if (!platform) return;

    if (platform === 'android') {
      window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault();
        deferredPrompt = e;
        bannerType = 'android';
        showBanner = true;
      });
    } else if (platform === 'ios') {
      bannerType = 'ios';
      showBanner = true;
    }
  });
</script>

{#if showBanner && bannerType === 'android'}
  <div
    class="pwa-banner android"
    style="transform: translateX({swipeOffset}px); opacity: {1 - Math.abs(swipeOffset) / 200}"
    role="complementary"
    aria-label="Install app prompt"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <button class="pwa-dismiss" onclick={dismiss} aria-label="Dismiss">&times;</button>
    <div class="pwa-content">
      <span class="pwa-icon">📱</span>
      <div class="pwa-text">
        <strong>Install Food Tracker</strong>
        <span>Add to your home screen for quick access</span>
      </div>
      <button class="pwa-install-btn" onclick={handleInstall}>Install</button>
    </div>
  </div>
{/if}

{#if showBanner && bannerType === 'ios'}
  <div
    class="pwa-banner ios"
    style="transform: translateX({swipeOffset}px); opacity: {1 - Math.abs(swipeOffset) / 200}"
    role="complementary"
    aria-label="Install app instructions"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <button class="pwa-dismiss" onclick={dismiss} aria-label="Dismiss">&times;</button>
    <div class="pwa-content">
      <span class="pwa-icon">📲</span>
      <div class="pwa-text">
        <strong>Install Food Tracker</strong>
        <span>Tap <strong>Share ⬆️</strong> then <strong>"Add to Home Screen"</strong></span>
      </div>
    </div>
  </div>
{/if}

<style>
  .pwa-banner {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 55;
    padding: 12px 16px 16px;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.15);
    transition: transform 0.15s ease-out, opacity 0.15s ease-out;
    touch-action: pan-x;
    user-select: none;
  }
  .pwa-banner.android { background: linear-gradient(135deg, #2E7D32, #4CAF50); color: #fff; }
  .pwa-banner.ios { background: linear-gradient(135deg, #1565C0, #42A5F5); color: #fff; }
  .pwa-dismiss {
    position: absolute;
    top: 6px;
    right: 10px;
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 20px;
    padding: 2px 6px;
    cursor: pointer;
    line-height: 1;
  }
  .pwa-dismiss:hover { color: #fff; }
  .pwa-content {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pwa-icon { font-size: 24px; flex-shrink: 0; }
  .pwa-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .pwa-text strong { font-size: 14px; }
  .pwa-text span { font-size: 12px; opacity: 0.9; }
  .pwa-install-btn {
    background: #fff;
    color: #2E7D32;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .pwa-install-btn:hover { background: #e8f5e9; }
</style>
