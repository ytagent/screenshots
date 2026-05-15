import type { Rectangle, WebContents } from 'electron';
import type {
  CapturedFrame,
  FrameCaptureAdapter,
  ScrollAdapter,
  ScrollState,
} from 'scrollshot-session';
import type { Bounds, ScreenshotsData } from '../preload.js';
import { nativeImageToPixelImage } from './nativeImage.js';

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

export class ElectronControlledContentAdapter
  implements FrameCaptureAdapter, ScrollAdapter
{
  public constructor(
    private readonly webContents: WebContents,
    private readonly captureRect?: Rectangle,
  ) {}

  public async captureFrame(): Promise<CapturedFrame> {
    const image =
      this.captureRect === undefined
        ? await this.webContents.capturePage()
        : await this.webContents.capturePage(this.captureRect);
    const frame: CapturedFrame = {
      image: nativeImageToPixelImage(image),
      timestamp: Date.now(),
      deviceScaleFactor: 1,
    };
    if (this.captureRect) {
      frame.captureRect = this.captureRect;
    }
    return frame;
  }

  public async scrollBy(deltaY: number): Promise<ScrollState> {
    return this.webContents.executeJavaScript(
      `(() => {
        window.scrollBy(0, ${Math.round(deltaY)});
        return {
          scrollTop: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          atBottom:
            window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 1
        };
      })()`,
    );
  }

  public async getState(): Promise<ScrollState> {
    return this.webContents.executeJavaScript(`(() => ({
      scrollTop: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      atBottom:
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 1
    }))()`);
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
