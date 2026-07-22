const DISMISS_KEY = 'pwa_install_dismissed';
const DISMISS_DAYS = 7;

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;
}

export function isDismissed(): boolean {
  const val = localStorage.getItem(DISMISS_KEY);
  if (!val) return false;
  const dismissedAt = parseInt(val, 10);
  const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
  return daysSince < DISMISS_DAYS;
}

export function markDismissed() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

export function detectPlatform(ua?: string): 'android' | 'ios' | null {
  const userAgent = ua || navigator.userAgent;
  if (/android/i.test(userAgent)) return 'android';
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios';
  return null;
}
