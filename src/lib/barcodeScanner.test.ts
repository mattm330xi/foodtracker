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
});
