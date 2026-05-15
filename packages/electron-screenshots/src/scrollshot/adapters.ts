import type { Bounds, ScreenshotsData } from '../preload.js';

export interface ScrollshotCaptureAdapter {
  capture(data: ScreenshotsData): Promise<Buffer>;
}

export interface ScrollshotScrollAdapter {
  scrollBy(bounds: Bounds, deltaY: number): Promise<boolean>;
}

export class ElectronControlledContentScrollAdapter
  implements ScrollshotScrollAdapter
{
  public async scrollBy(): Promise<boolean> {
    return false;
  }
}

export class WindowsScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(): Promise<boolean> {
    throw new Error(
      'Windows external-window scrolling is scaffolded only. Next step: implement UI Automation ScrollPattern, then SendInput wheel fallback.',
    );
  }
}

export class MacOSScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(): Promise<boolean> {
    throw new Error(
      'macOS external-window scrolling is scaffolded only. Next step: implement Accessibility scrolling with ScreenCaptureKit capture after permissions are verified on macOS.',
    );
  }
}
