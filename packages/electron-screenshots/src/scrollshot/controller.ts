import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
} from 'electron';
import type { Bounds, ScreenshotsData } from '../preload.js';

export type LongScreenshotProgressState =
  | 'starting'
  | 'capturing'
  | 'scrolling'
  | 'stitching'
  | 'failed'
  | 'cancelled';

export interface LongScreenshotProgress {
  state: LongScreenshotProgressState;
  message?: string;
  frameCount?: number;
  warnings?: string[];
}

export interface LongScreenshotControllerHandle {
  readonly window?: BrowserWindow;
  update(progress: LongScreenshotProgress): void;
  destroy(): void;
}

export interface LongScreenshotControllerOptions {
  data: ScreenshotsData;
  finish: () => Promise<void>;
  cancel: () => void;
  logger?: (...args: unknown[]) => void;
  onShown?: (window: BrowserWindow) => void;
}

class ElectronLongScreenshotController
  implements LongScreenshotControllerHandle
{
  private progress: LongScreenshotProgress | null = null;

  private disposed = false;

  private readonly finishListener = (event: IpcMainEvent) => {
    if (event.sender === this.window.webContents) {
      this.onFinish().catch(() => undefined);
    }
  };

  private readonly cancelListener = (event: IpcMainEvent) => {
    if (event.sender === this.window.webContents) {
      this.onCancel();
    }
  };

  public constructor(
    public readonly window: BrowserWindow,
    private readonly onFinish: () => Promise<void>,
    private readonly onCancel: () => void,
  ) {
    ipcMain.on(
      'SCREENSHOTS:longScreenshot-controller-finish',
      this.finishListener,
    );
    ipcMain.on(
      'SCREENSHOTS:longScreenshot-controller-cancel',
      this.cancelListener,
    );
    this.window.webContents.on('will-navigate', (event, url) => {
      if (url === 'scrollshot://finish') {
        event.preventDefault();
        this.onFinish().catch(() => undefined);
        return;
      }
      if (url === 'scrollshot://cancel') {
        event.preventDefault();
        this.onCancel();
      }
    });
    this.window.webContents.on('did-finish-load', () => {
      if (this.progress) {
        this.update(this.progress);
      }
    });
    this.window.on('closed', () => {
      this.disposeListeners();
    });
  }

  public update(progress: LongScreenshotProgress): void {
    this.progress = progress;
    if (this.window.isDestroyed() || this.window.webContents.isLoading()) {
      return;
    }
    this.window.webContents
      .executeJavaScript(
        `window.__setScrollshotProgress(${JSON.stringify(progress)})`,
      )
      .catch(() => undefined);
  }

  public destroy(): void {
    this.disposeListeners();
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
  }

  private disposeListeners(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    ipcMain.off(
      'SCREENSHOTS:longScreenshot-controller-finish',
      this.finishListener,
    );
    ipcMain.off(
      'SCREENSHOTS:longScreenshot-controller-cancel',
      this.cancelListener,
    );
  }
}

export function createLongScreenshotController({
  data,
  finish,
  cancel,
  logger,
  onShown,
}: LongScreenshotControllerOptions): LongScreenshotControllerHandle {
  const bounds = getLongScreenshotControllerBounds(data);

  const window = new BrowserWindow({
    title: 'long screenshot controls',
    width: bounds.width,
    height: bounds.height,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: require.resolve('./controllerPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 窗口豁免屏幕捕获——macOS 的 NSWindowSharingNone /
  // Windows 的 WDA_EXCLUDEFROMCAPTURE。控制器可放在任意位置而不会被截进长截图里。
  window.setContentProtection(true);

  if (process.platform !== 'win32') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  window.setAlwaysOnTop(true);
  const controller = new ElectronLongScreenshotController(
    window,
    finish,
    cancel,
  );
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.setBounds(bounds);
      window.show();
      onShown?.(window);
    }
  });
  window.loadURL(getLongScreenshotControllerUrl());
  logger?.('SCREENSHOTS:longScreenshot controller created at %o', bounds);

  return controller;
}

export function getLongScreenshotControllerBounds(
  data: ScreenshotsData,
): Bounds {
  const display = data.display;
  const margin = 12;
  const gap = 8;
  const width = Math.min(280, Math.max(200, display.width - margin * 2));
  const height = 44;

  const displayLeft = display.x + margin;
  const displayTop = display.y + margin;
  const displayRight = display.x + display.width - margin;
  const displayBottom = display.y + display.height - margin;

  const selection = {
    x: display.x + data.bounds.x,
    y: display.y + data.bounds.y,
    width: data.bounds.width,
    height: data.bounds.height,
  };

  const clamp = (value: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, value));
  // 右对齐选区，与工具栏视觉重心接近，让用户视线不用大跳
  const alignedX = clamp(
    selection.x + selection.width - width,
    displayLeft,
    Math.max(displayLeft, displayRight - width),
  );
  const alignedY = clamp(
    selection.y + selection.height - height,
    displayTop,
    Math.max(displayTop, displayBottom - height),
  );

  if (selection.y + selection.height + gap + height <= displayBottom) {
    return { x: alignedX, y: selection.y + selection.height + gap, width, height };
  }
  if (selection.y - gap - height >= displayTop) {
    return { x: alignedX, y: selection.y - gap - height, width, height };
  }
  if (selection.x + selection.width + gap + width <= displayRight) {
    return { x: selection.x + selection.width + gap, y: alignedY, width, height };
  }
  if (selection.x - gap - width >= displayLeft) {
    return { x: selection.x - gap - width, y: alignedY, width, height };
  }
  // 选区铺满屏幕，外部塞不下。落到选区内部右下角；
  // setContentProtection 已豁免屏幕捕获，不会被拼进长截图。
  return {
    x: clamp(
      selection.x + selection.width - width - margin,
      displayLeft,
      Math.max(displayLeft, displayRight - width),
    ),
    y: clamp(
      selection.y + selection.height - height - margin,
      displayTop,
      Math.max(displayTop, displayBottom - height),
    ),
    width,
    height,
  };
}

function getLongScreenshotControllerUrl(): string {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; }
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  color: #f9fafb;
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
  -webkit-user-select: none;
}
.pill {
  height: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 12px;
  background: rgba(17, 24, 39, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  -webkit-app-region: drag;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #39f;
  box-shadow: 0 0 8px rgba(51, 153, 255, 0.55);
  flex-shrink: 0;
  animation: pulse 1.4s ease-in-out infinite;
}
.dot.failed { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.55); animation: none; }
.dot.stitching { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.55); }
.dot.cancelled { background: #9ca3af; box-shadow: none; animation: none; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label .title { font-weight: 600; }
.label .meta { color: #9ca3af; margin-left: 6px; }
button {
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: #f9fafb;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}
button.finish { background: #0f766e; }
button.cancel { background: rgba(255, 255, 255, 0.10); }
button:hover { filter: brightness(1.15); }
button:active { transform: translateY(1px); }
</style>
</head>
<body>
<div class="pill">
  <div class="dot" id="dot"></div>
  <div class="label">
    <span class="title" id="title">长截图</span>
    <span class="meta" id="meta">0 帧</span>
  </div>
  <button class="finish" data-action="finish" title="Enter">完成</button>
  <button class="cancel" data-action="cancel" title="Esc">取消</button>
</div>
<script>
const dot = document.getElementById('dot');
const title = document.getElementById('title');
const meta = document.getElementById('meta');
const TITLES = {
  failed: '失败',
  cancelled: '已取消',
  stitching: '拼接中',
  starting: '准备中',
  capturing: '采集中',
};
const DOT_CLASSES = {
  failed: 'dot failed',
  stitching: 'dot stitching',
  cancelled: 'dot cancelled',
};
window.__setScrollshotProgress = (progress) => {
  const frameCount = progress.frameCount || 0;
  const state = progress.state || 'capturing';
  dot.className = DOT_CLASSES[state] || 'dot';
  title.textContent = TITLES[state] || TITLES.capturing;
  meta.textContent = frameCount > 0 ? frameCount + ' 帧' : '';
};
document.querySelector('[data-action="finish"]').addEventListener('click', () => {
  if (window.scrollshotController) {
    window.scrollshotController.finish();
  }
});
document.querySelector('[data-action="cancel"]').addEventListener('click', () => {
  if (window.scrollshotController) {
    window.scrollshotController.cancel();
  }
});
</script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
