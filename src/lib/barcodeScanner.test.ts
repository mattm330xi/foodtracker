import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/svelte';

function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createMockStream() {
  const track = { stop: vi.fn(), kind: 'video' as const, enabled: true } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

const mockGetUserMedia = vi.fn(() => Promise.resolve(createMockStream()));
const mockDetect = vi.fn(() => Promise.resolve([]));
const mockGetSupportedFormats = vi.fn(() => Promise.resolve(['upc_a', 'upc_e', 'ean_13', 'ean_8']));

let mockStream: ReturnType<typeof createMockStream>;

beforeEach(() => {
  vi.clearAllMocks();
  mockStream = createMockStream();
  mockGetUserMedia.mockResolvedValue(mockStream);
  mockDetect.mockResolvedValue([]);
  mockGetSupportedFormats.mockResolvedValue(['upc_a', 'upc_e', 'ean_13', 'ean_8']);

  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });

  (globalThis as any).BarcodeDetector = class {
    constructor() {}
    detect = mockDetect;
    static getSupportedFormats = mockGetSupportedFormats;
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  delete (globalThis as any).BarcodeDetector;
});

import BarcodeScanner from './BarcodeScanner.svelte';

describe('BarcodeScanner teardown', () => {
  it('start() calls getUserMedia and begins scanning', async () => {
    const { component } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });
    expect(mockGetUserMedia).toHaveBeenCalled();
  });

  it('stop() calls track.stop()', async () => {
    const { component } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });

    await act(async () => { (component as any).stopScanner(); await flush(); });
    const track = (mockStream.getTracks() as any)[0];
    expect(track.stop).toHaveBeenCalled();
  });

  it('stopScanner is no-op when not started', async () => {
    const { component } = render(BarcodeScanner);
    (component as any).stopScanner();
    await flush();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('isTransitioning blocks double start()', async () => {
    const { component } = render(BarcodeScanner);
    await act(async () => {
      (component as any).startScanner();
      (component as any).startScanner();
      await flush();
    });
    expect(mockGetUserMedia).toHaveBeenCalledOnce();
  });

  it('reports camera error when permission denied', async () => {
    mockGetUserMedia.mockRejectedValue(new DOMException('NotAllowedError', 'NotAllowedError'));
    const { component, container } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });
    expect(container.querySelector('[data-testid="result"]')?.textContent).toContain('Camera permission denied');
  });

  it('reports camera error for other failures', async () => {
    mockGetUserMedia.mockRejectedValue(new Error('Not found'));
    const { component, container } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });
    expect(container.querySelector('[data-testid="result"]')?.textContent).toContain('Not found');
  });

  it('onDestroy cleans up stream', async () => {
    const { component, unmount } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });
    unmount();
    await flush();
    const track = (mockStream.getTracks() as any)[0];
    expect(track.stop).toHaveBeenCalled();
  });

  it('shows unsupported message when BarcodeDetector missing', async () => {
    delete (globalThis as any).BarcodeDetector;
    const { component, container } = render(BarcodeScanner);
    await act(async () => { await (component as any).startScanner(); await flush(); });
    expect(container.querySelector('[data-testid="result"]')?.textContent).toContain('not supported');
  });

  it('ignores a detection that resolves after stopScanner() was already called', async () => {
    // Regression: a frame's detect() call was already in flight when the
    // parent stopped the scanner (e.g. on a successful lookup). Letting that
    // stale result still fire onBarcode caused the UI to flicker back into
    // "looking up" and re-show the camera view right after it was hidden.
    let resolveDetect: (v: any[]) => void = () => {};
    (mockDetect as any).mockImplementation(() => new Promise((resolve) => { resolveDetect = resolve; }));

    const onBarcode = vi.fn();
    const { component, container } = render(BarcodeScanner, { props: { onBarcode } });
    await act(async () => { await (component as any).startScanner(); await flush(); });

    // jsdom's <video> never reaches a real readyState on its own; scanFrame
    // requires readyState >= 2 before it will call detect() at all.
    const video = container.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });

    // Let the scan loop's rAF fire and enter its in-flight detect() call.
    await act(async () => { await flush(50); });
    expect(mockDetect).toHaveBeenCalled();

    // Stop the scanner while that detect() call is still pending.
    await act(async () => { (component as any).stopScanner(); });

    // Now the stale detect() resolves with a barcode — it must be ignored.
    await act(async () => { resolveDetect([{ rawValue: '0123456789012' }]); await flush(50); });

    expect(onBarcode).not.toHaveBeenCalled();
  });
});
