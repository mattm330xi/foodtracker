// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
  interface BarcodeDetectorResult {
    rawValue: string;
    format: string;
    cornerPoints: Array<{ x: number; y: number }>;
  }

  class BarcodeDetector {
    constructor(options?: { formats?: string[] });
    detect(image: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
    static getSupportedFormats(): Promise<string[]>;
  }

  namespace App {
    interface Locals {
      userId: number;
      username: string;
      timezone: string;
    }
    interface Platform {
      env: {
        FTD1: D1Database;
      };
      context: {
        waitUntil: (promise: Promise<any>) => void;
      };
      caches: CacheStorage;
    }
    interface Error {}
    interface PageData {}
    interface PageState {}
    interface Platform {}
  }
}

export {};
