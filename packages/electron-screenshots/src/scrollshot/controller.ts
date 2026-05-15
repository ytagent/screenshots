import { BrowserWindow } from 'electron';
import type { Bounds, ScreenshotsData } from '../preload.js';

export interface LongScreenshotProgress {
  state: string;
  message?: string;
  frameCount?: number;
  warnings?: string[];
}

export interface LongScreenshotControllerHandle {
  readonly window: BrowserWindow;
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

  public constructor(
    public readonly window: BrowserWindow,
    private readonly onFinish: () => Promise<void>,
    private readonly onCancel: () => void,
  ) {
    this.window.webContents.on('will-navigate', (event, url) => {
      if (url === 'scrollshot://finish') {
        event.preventDefault();
        this.onFinish();
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
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
  }
}

export function createLongScreenshotController({
  data,
  finish,
  cancel,
  logger,
  onShown,
}: LongScreenshotControllerOptions): LongScreenshotControllerHandle | null {
  const bounds = getLongScreenshotControllerBounds(data);
  if (!bounds) {
    logger?.(
      'SCREENSHOTS:longScreenshot controller skipped; no safe position outside capture bounds',
    );
    return null;
  }

  const window = new BrowserWindow({
    title: 'long screenshot controls',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    useContentSize: true,
    frame: false,
    show: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#111827',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

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
      window.show();
      onShown?.(window);
    }
  });
  window.loadURL(getLongScreenshotControllerUrl());

  return controller;
}

export function getLongScreenshotControllerBounds(
  data: ScreenshotsData,
): Bounds | null {
  const display = data.display;
  const margin = 12;
  const gap = 12;
  const controllerWidth = Math.min(
    320,
    Math.max(220, display.width - margin * 2),
  );
  const controllerHeight = 76;
  if (
    controllerWidth > display.width - margin * 2 ||
    controllerHeight > display.height - margin * 2
  ) {
    return null;
  }

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
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  const alignedX = clamp(
    selection.x + selection.width - controllerWidth,
    displayLeft,
    displayRight - controllerWidth,
  );
  const alignedY = clamp(
    selection.y + selection.height - controllerHeight,
    displayTop,
    displayBottom - controllerHeight,
  );

  if (selection.y + selection.height + gap + controllerHeight <= displayBottom) {
    return {
      x: alignedX,
      y: selection.y + selection.height + gap,
      width: controllerWidth,
      height: controllerHeight,
    };
  }
  if (selection.y - gap - controllerHeight >= displayTop) {
    return {
      x: alignedX,
      y: selection.y - gap - controllerHeight,
      width: controllerWidth,
      height: controllerHeight,
    };
  }
  if (selection.x + selection.width + gap + controllerWidth <= displayRight) {
    return {
      x: selection.x + selection.width + gap,
      y: alignedY,
      width: controllerWidth,
      height: controllerHeight,
    };
  }
  if (selection.x - gap - controllerWidth >= displayLeft) {
    return {
      x: selection.x - gap - controllerWidth,
      y: alignedY,
      width: controllerWidth,
      height: controllerHeight,
    };
  }
  return null;
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
  background: #111827;
  color: #f9fafb;
  font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  user-select: none;
}
.wrap {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  padding: 10px;
}
.status {
  min-width: 0;
}
.title {
  color: #f9fafb;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  color: #cbd5e1;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button {
  width: 58px;
  height: 34px;
  border: 0;
  border-radius: 6px;
  color: #f9fafb;
  font: inherit;
  font-weight: 600;
}
button.finish { background: #0f766e; }
button.cancel { background: #4b5563; }
button:hover { filter: brightness(1.08); }
button:active { transform: translateY(1px); }
</style>
</head>
<body>
<div class="wrap">
  <div class="status">
    <div class="title" id="title">长截图采集中</div>
    <div class="meta" id="meta">已捕获 0 帧</div>
  </div>
  <button class="finish" data-action="finish">完成</button>
  <button class="cancel" data-action="cancel">取消</button>
</div>
<script>
const title = document.getElementById('title');
const meta = document.getElementById('meta');
window.__setScrollshotProgress = (progress) => {
  const frameCount = progress.frameCount || 0;
  title.textContent = progress.state === 'stitching' ? '长截图拼接中' : '长截图采集中';
  meta.textContent = '已捕获 ' + frameCount + ' 帧';
};
document.querySelector('[data-action="finish"]').addEventListener('click', () => {
  window.location.href = 'scrollshot://finish';
});
document.querySelector('[data-action="cancel"]').addEventListener('click', () => {
  window.location.href = 'scrollshot://cancel';
});
</script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
