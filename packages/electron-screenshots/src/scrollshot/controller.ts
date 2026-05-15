import {
  BrowserWindow,
  Menu,
  ipcMain,
  type IpcMainEvent,
  type MenuItemConstructorOptions,
} from 'electron';
import type { Bounds, ScreenshotsData } from '../preload.js';

export interface LongScreenshotProgress {
  state: string;
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
  onFallbackShown?: () => void;
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

class ElectronLongScreenshotMenuController
  implements LongScreenshotControllerHandle
{
  private progress: LongScreenshotProgress | null = null;

  private disposed = false;

  private readonly previousMenu = Menu.getApplicationMenu();

  public constructor(
    private readonly onFinish: () => Promise<void>,
    private readonly onCancel: () => void,
    private readonly logger?: (...args: unknown[]) => void,
  ) {
    this.installMenu();
  }

  public update(progress: LongScreenshotProgress): void {
    this.progress = progress;
    this.installMenu();
  }

  public destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    Menu.setApplicationMenu(this.previousMenu);
  }

  private installMenu(): void {
    if (this.disposed) {
      return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(this.getMenuTemplate()));
  }

  private getMenuTemplate(): MenuItemConstructorOptions[] {
    const frameCount = this.progress?.frameCount ?? 0;
    const state = this.progress?.state ?? 'capturing';
    const message =
      this.progress?.message ?? 'Long screenshot capture is active.';
    return [
      {
        label: 'Long Screenshot',
        submenu: [
          {
            label:
              frameCount > 0
                ? `Captured ${frameCount} frame${frameCount === 1 ? '' : 's'}`
                : 'Preparing capture',
            enabled: false,
          },
          {
            label: truncateMenuLabel(`${state}: ${message}`),
            enabled: false,
          },
          { type: 'separator' },
          {
            label: 'Finish Long Screenshot',
            accelerator: 'Enter',
            click: () => {
              this.onFinish().catch((err) => {
                this.logger?.(
                  'SCREENSHOTS:longScreenshot menu finish error %o',
                  err,
                );
              });
            },
          },
          {
            label: 'Cancel Long Screenshot',
            accelerator: 'Esc',
            click: () => {
              this.onCancel();
            },
          },
        ],
      },
    ];
  }
}

export function createLongScreenshotController({
  data,
  finish,
  cancel,
  logger,
  onShown,
  onFallbackShown,
}: LongScreenshotControllerOptions): LongScreenshotControllerHandle | null {
  const bounds = getLongScreenshotControllerBounds(data);
  if (!bounds) {
    logger?.(
      'SCREENSHOTS:longScreenshot controller using menu fallback; no safe position outside capture bounds',
    );
    const fallback = new ElectronLongScreenshotMenuController(
      finish,
      cancel,
      logger,
    );
    onFallbackShown?.();
    return fallback;
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
      preload: require.resolve('./controllerPreload.js'),
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
  const controllerHeight = 104;
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

function truncateMenuLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 72
    ? `${normalized.slice(0, 69).trimEnd()}...`
    : normalized;
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
.message {
  color: #d1d5db;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warnings {
  color: #fbbf24;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.warnings:empty {
  display: none;
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
    <div class="message" id="message">请在选区内滚动，完成后点击完成</div>
    <div class="warnings" id="warnings"></div>
  </div>
  <button class="finish" data-action="finish">完成</button>
  <button class="cancel" data-action="cancel">取消</button>
</div>
<script>
const title = document.getElementById('title');
const meta = document.getElementById('meta');
const message = document.getElementById('message');
const warnings = document.getElementById('warnings');
window.__setScrollshotProgress = (progress) => {
  const frameCount = progress.frameCount || 0;
  const warningList = Array.isArray(progress.warnings) ? progress.warnings : [];
  title.textContent =
    progress.state === 'failed'
      ? '长截图失败'
      : progress.state === 'cancelled'
        ? '长截图已取消'
        : progress.state === 'stitching'
          ? '长截图拼接中'
          : '长截图采集中';
  meta.textContent = '已捕获 ' + frameCount + ' 帧';
  message.textContent = progress.message || '请在选区内滚动，完成后点击完成';
  warnings.textContent =
    warningList.length > 0
      ? '警告：' + warningList[warningList.length - 1]
      : '';
};
document.querySelector('[data-action="finish"]').addEventListener('click', () => {
  if (window.scrollshotController) {
    window.scrollshotController.finish();
  } else {
    window.location.href = 'scrollshot://finish';
  }
});
document.querySelector('[data-action="cancel"]').addEventListener('click', () => {
  if (window.scrollshotController) {
    window.scrollshotController.cancel();
  } else {
    window.location.href = 'scrollshot://cancel';
  }
});
</script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
