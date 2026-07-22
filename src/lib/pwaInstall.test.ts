import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectPlatform, isDismissed, markDismissed, isStandalone } from './pwaInstall';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('detectPlatform', () => {
  it('returns android for Android user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36')).toBe('android');
  });

  it('returns ios for iPhone user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
  });

  it('returns ios for iPad user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios');
  });

  it('returns ios for iPod user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (iPod; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
  });

  it('returns null for desktop user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBeNull();
  });

  it('returns null for empty user agent', () => {
    expect(detectPlatform('')).toBeNull();
  });
});

describe('markDismissed and isDismissed', () => {
  it('returns false when nothing stored', () => {
    expect(isDismissed()).toBe(false);
  });

  it('returns true after marking dismissed', () => {
    markDismissed();
    expect(isDismissed()).toBe(true);
  });

  it('returns false after 7 days', () => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1000;
    localStorage.setItem('pwa_install_dismissed', String(sevenDaysAgo));
    expect(isDismissed()).toBe(false);
  });

  it('returns true for 6 days ago', () => {
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
    localStorage.setItem('pwa_install_dismissed', String(sixDaysAgo));
    expect(isDismissed()).toBe(true);
  });

  it('returns false for 8 days ago', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('pwa_install_dismissed', String(eightDaysAgo));
    expect(isDismissed()).toBe(false);
  });

  it('handles invalid stored value as not dismissed', () => {
    localStorage.setItem('pwa_install_dismissed', 'not-a-number');
    expect(isDismissed()).toBe(false); // parseInt returns NaN, NaN < 7 is false → not dismissed
  });
});

describe('isStandalone', () => {
  it('returns false when display-mode is browser', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isStandalone()).toBe(false);
  });

  it('returns true when display-mode is standalone', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(isStandalone()).toBe(true);
  });
});
