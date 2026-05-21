import { BrowserWindow } from 'electron';
import type { Bounds, ScreenshotsData } from '../preload.js';

export interface LongScreenshotIndicatorHandle {
  readonly window: BrowserWindow;
  destroy(): void;
}

const BORDER_WIDTH = 2;

export function createLongScreenshotIndicator(
  data: ScreenshotsData,
): LongScreenshotIndicatorHandle {
  const bounds = getLongScreenshotIndicatorBounds(data);
  const window = new BrowserWindow({
    title: 'long screenshot selection indicator',
    width: bounds.width,
    height: bounds.height,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  window.setContentProtection(true);
  window.setIgnoreMouseEvents(true, { forward: true });

  if (process.platform !== 'win32') {
    window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  window.setAlwaysOnTop(true);
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.setBounds(bounds);
      window.showInactive();
    }
  });
  window.loadURL(getLongScreenshotIndicatorUrl());

  return {
    window,
    destroy() {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    },
  };
}

function getLongScreenshotIndicatorBounds(data: ScreenshotsData): Bounds {
  const x = Math.round(data.display.x + data.bounds.x - BORDER_WIDTH);
  const y = Math.round(data.display.y + data.bounds.y - BORDER_WIDTH);
  const width = Math.max(1, Math.round(data.bounds.width + BORDER_WIDTH * 2));
  const height = Math.max(1, Math.round(data.bounds.height + BORDER_WIDTH * 2));
  return { x, y, width, height };
}

function getLongScreenshotIndicatorUrl(): string {
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
}
.selection {
  position: fixed;
  inset: 0;
  border: ${BORDER_WIDTH}px solid rgba(51, 153, 255, 0.95);
}
</style>
</head>
<body>
<div class="selection"></div>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
