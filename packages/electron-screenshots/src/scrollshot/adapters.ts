import { execFile } from 'node:child_process';
import { screen, type Rectangle, type WebContents } from 'electron';
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

export interface PlatformScrollResult {
  ok: boolean;
  method: string;
  reason?: string;
}

export interface ScrollshotScrollAdapter {
  scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult>;
}

export class ElectronControlledContentScrollAdapter
  implements ScrollshotScrollAdapter
{
  public async scrollBy(): Promise<PlatformScrollResult> {
    return {
      ok: false,
      method: 'electron-controlled-content',
      reason:
        'Use ElectronControlledContentAdapter for automatic controlled-content scrolling.',
    };
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
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const wheelDelta = deltaY >= 0 ? -wheelTicks(deltaY) : wheelTicks(deltaY);
    const script = `
Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
'@
[Win32.NativeMethods]::SetCursorPos(${point.x}, ${point.y}) | Out-Null
Start-Sleep -Milliseconds 20
[Win32.NativeMethods]::mouse_event(0x0800, 0, 0, ${wheelDelta}, [UIntPtr]::Zero)
`;
    try {
      await runCommand(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          script,
        ],
        2500,
      );
      return { ok: true, method: 'windows-mouse-wheel' };
    } catch (err) {
      return {
        ok: false,
        method: 'windows-mouse-wheel',
        reason: errorMessage(err),
      };
    }
  }
}

export class MacOSScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const direction = deltaY >= 0 ? 'down' : 'up';
    const notches = Math.max(1, Math.min(8, Math.round(Math.abs(deltaY) / 120)));
    try {
      await runCommand(
        '/usr/bin/osascript',
        [
          '-e',
          `tell application "System Events" to set the mouse location to {${point.x}, ${point.y}}`,
          '-e',
          `tell application "System Events" to scroll ${direction} ${notches}`,
        ],
        2500,
      );
      return { ok: true, method: 'macos-accessibility-wheel' };
    } catch (err) {
      return {
        ok: false,
        method: 'macos-accessibility-wheel',
        reason: `${errorMessage(
          err,
        )}. macOS external automatic scrolling requires Accessibility permission for the host app.`,
      };
    }
  }
}

export class LinuxX11ScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const button = deltaY >= 0 ? '5' : '4';
    const repeat = Math.max(1, Math.min(8, Math.round(Math.abs(deltaY) / 120)));
    try {
      await runCommand(
        'xdotool',
        ['mousemove', String(point.x), String(point.y), 'click', '--repeat', String(repeat), button],
        2500,
      );
      return { ok: true, method: 'linux-xdotool-wheel' };
    } catch (err) {
      return {
        ok: false,
        method: 'linux-xdotool-wheel',
        reason: `${errorMessage(
          err,
        )}. Install xdotool or use manual-assisted scrollshot on Linux.`,
      };
    }
  }
}

export function createPlatformScrollAdapter(): ScrollshotScrollAdapter | null {
  if (process.platform === 'win32') {
    return new WindowsScrollAdapter();
  }
  if (process.platform === 'darwin') {
    return new MacOSScrollAdapter();
  }
  if (process.platform === 'linux') {
    return new LinuxX11ScrollAdapter();
  }
  return null;
}

function getCenterScreenPoint(
  bounds: Bounds,
  display?: ScreenshotsData['display'],
): { x: number; y: number } {
  const dipPoint = {
    x: Math.round((display?.x ?? 0) + bounds.x + bounds.width / 2),
    y: Math.round((display?.y ?? 0) + bounds.y + bounds.height / 2),
  };
  if (process.platform === 'win32') {
    const physicalPoint = screen.dipToScreenPoint(dipPoint);
    return {
      x: Math.round(physicalPoint.x),
      y: Math.round(physicalPoint.y),
    };
  }
  return dipPoint;
}

function wheelTicks(deltaY: number): number {
  return Math.max(120, Math.min(960, Math.round(Math.abs(deltaY) / 120) * 120));
}

function runCommand(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              [error.message, stdout.toString().trim(), stderr.toString().trim()]
                .filter(Boolean)
                .join('\n'),
            ),
          );
          return;
        }
        resolve();
      },
    );
    child.on('error', reject);
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
