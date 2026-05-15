import { Display } from './electron/app';
import { Bounds } from './Screenshots/types';

// biome-ignore lint/suspicious/noExplicitAny: bridge listeners receive channel-specific payloads
type ScreenshotsListener = (...args: any[]) => void;

interface ScreenshotsData {
  bounds: Bounds;
  display: Display;
  longScreenshot?: boolean;
}

interface GlobalScreenshots {
  ready: () => void;
  reset: () => void;
  save: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => void;
  cancel: () => void;
  ok: (arrayBuffer: ArrayBuffer, data: ScreenshotsData) => void;
  longScreenshotStart: (data: ScreenshotsData) => void;
  on: (channel: string, fn: ScreenshotsListener) => void;
  off: (channel: string, fn: ScreenshotsListener) => void;
}

declare global {
  interface Window {
    screenshots: GlobalScreenshots;
  }
}
