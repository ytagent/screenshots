import Events from 'node:events';
import debug, { type Debugger } from 'debug';
import {
  BrowserView,
  BrowserWindow,
  clipboard,
  type DesktopCapturerSource,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  type NativeImage,
  screen,
} from 'electron';
import fs from 'fs-extra';
import { stitchFrames, type ScrollshotFrame } from 'scrollshot-core';
import Event from './event.js';
import getDisplay, { type Display } from './getDisplay.js';
import padStart from './padStart.js';
import type { Bounds, ScreenshotsData } from './preload.js';
import {
  cropNativeImageByDipBounds,
  nativeImageToPixelImage,
  pixelImageToNativeImage,
} from './scrollshot/nativeImage.js';

export type LoggerFn = (...args: unknown[]) => void;
export type Logger = Debugger | LoggerFn;

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface Lang {
  magnifier_position_label?: string;
  operation_ok_title?: string;
  operation_cancel_title?: string;
  operation_save_title?: string;
  operation_redo_title?: string;
  operation_undo_title?: string;
  operation_mosaic_title?: string;
  operation_text_title?: string;
  operation_brush_title?: string;
  operation_arrow_title?: string;
  operation_ellipse_title?: string;
  operation_rectangle_title?: string;
  operation_long_screenshot_title?: string;
}

export interface ScreenshotsOpts {
  lang?: Lang;
  logger?: Logger;
  singleWindow?: boolean;
}

export type { Bounds };

export default class Screenshots extends Events {
  // 截图窗口对象
  public $win: BrowserWindow | null = null;

  public $view: BrowserView = new BrowserView({
    webPreferences: {
      preload: require.resolve('./preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  private logger: Logger;

  private singleWindow: boolean;

  private longScreenshotSession: {
    cancel: () => void;
    finish: () => Promise<void>;
  } | null = null;

  private isReady = new Promise<void>((resolve) => {
    ipcMain.once('SCREENSHOTS:ready', () => {
      this.logger('SCREENSHOTS:ready');

      resolve();
    });
  });

  constructor(opts?: ScreenshotsOpts) {
    super();
    this.logger = opts?.logger || debug('electron-screenshots');
    this.singleWindow = opts?.singleWindow || false;
    this.listenIpc();
    this.$view.webContents.loadURL(
      `file://${require.resolve('react-screenshots/dist/electron.html')}`,
    );
    if (opts?.lang) {
      this.setLang(opts.lang);
    }
  }

  /**
   * 开始截图
   */
  public async startCapture(): Promise<void> {
    this.logger('startCapture');

    const display = getDisplay();

    const [imageUrl] = await Promise.all([this.capture(display), this.isReady]);

    await this.createWindow(display);

    this.$view.webContents.send('SCREENSHOTS:capture', display, imageUrl);
  }

  /**
   * 结束截图
   */
  public async endCapture(): Promise<void> {
    this.logger('endCapture');
    if (this.longScreenshotSession) {
      this.longScreenshotSession.cancel();
    }
    await this.reset();

    if (!this.$win) {
      return;
    }

    // 先清除 Kiosk 模式，然后取消全屏才有效
    this.$win.setKiosk(false);
    this.$win.blur();
    this.$win.blurWebView();
    this.$win.unmaximize();
    this.$win.removeBrowserView(this.$view);

    if (this.singleWindow) {
      this.$win.hide();
    } else {
      this.$win.destroy();
    }
  }

  /**
   * 设置语言
   */
  public async setLang(lang: Partial<Lang>): Promise<void> {
    this.logger('setLang', lang);

    await this.isReady;

    this.$view.webContents.send('SCREENSHOTS:setLang', lang);
  }

  private async reset() {
    // 重置截图区域
    this.$view.webContents.send('SCREENSHOTS:reset');

    // 保证 UI 有足够的时间渲染
    await Promise.race([
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 500);
      }),
      new Promise<void>((resolve) => {
        ipcMain.once('SCREENSHOTS:reset', () => resolve());
      }),
    ]);
  }

  /**
   * 初始化窗口
   */
  private async createWindow(display: Display): Promise<void> {
    // 重置截图区域
    await this.reset();

    // 复用未销毁的窗口
    if (!this.$win || this.$win?.isDestroyed?.()) {
      const windowTypes: Record<string, string | undefined> = {
        darwin: 'panel',
        // linux 必须设置为 undefined，否则会在部分系统上不能触发focus 事件
        // https://github.com/nashaofu/screenshots/issues/203#issuecomment-1518923486
        linux: undefined,
        win32: 'toolbar',
      };

      this.$win = new BrowserWindow({
        title: 'screenshots',
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
        useContentSize: true,
        type: windowTypes[process.platform] as string,
        frame: false,
        show: false,
        autoHideMenuBar: true,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        // focusable 必须设置为 true, 否则窗口不能及时响应esc按键，输入框也不能输入
        focusable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        /**
         * linux 下必须设置为false，否则不能全屏显示在最上层
         * mac 下设置为false，否则可能会导致程序坞不恢复问题，且与 kiosk 模式冲突
         */
        fullscreen: false,
        // mac fullscreenable 设置为 true 会导致应用崩溃
        fullscreenable: false,
        kiosk: true,
        backgroundColor: '#00000000',
        titleBarStyle: 'hidden',
        hasShadow: false,
        paintWhenInitiallyHidden: false,
        // mac 特有的属性
        roundedCorners: false,
        enableLargerThanScreen: false,
        acceptFirstMouse: true,
      });

      this.emit('windowCreated', this.$win);
      this.$win.on('show', () => {
        this.$win?.focus();
        this.$win?.setKiosk(true);
      });

      this.$win.on('closed', () => {
        this.emit('windowClosed', this.$win);
        this.$win = null;
      });
    }

    this.$win.setBrowserView(this.$view);

    // 适定平台
    if (process.platform === 'darwin') {
      this.$win.setWindowButtonVisibility(false);
    }

    if (process.platform !== 'win32') {
      this.$win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }

    this.$win.blur();
    this.$win.setBounds(display);
    this.$view.setBounds({
      x: 0,
      y: 0,
      width: display.width,
      height: display.height,
    });
    this.$win.setAlwaysOnTop(true);
    this.$win.show();
  }

  private async capture(display: Display): Promise<string> {
    const image = await this.captureNativeImage(display);
    return image.toDataURL();
  }

  private async captureNativeImage(display: Display): Promise<NativeImage> {
    this.logger('SCREENSHOTS:capture');

    const forceDesktopCapturer =
      process.env.SCREENSHOTS_CAPTURE_BACKEND === 'desktop-capturer';

    if (!forceDesktopCapturer) {
      try {
        const { Monitor } = await import('node-screenshots');
        let point = {
          x: display.x + display.width / 2,
          y: display.y + display.height / 2,
        };
        if (process.platform === 'win32') {
          point = screen.screenToDipPoint(point);
        }
        const monitor = Monitor.fromPoint(point.x, point.y);
        this.logger(
          'SCREENSHOTS:capture Monitor.fromPoint arguments %o',
          display,
        );
        this.logger('SCREENSHOTS:capture Monitor.fromPoint return %o', {
          id: monitor?.id,
          name: monitor?.name,
          x: monitor?.x,
          y: monitor?.y,
          width: monitor?.width,
          height: monitor?.height,
          rotation: monitor?.rotation,
          scaleFactor: monitor?.scaleFactor,
          frequency: monitor?.frequency,
          isPrimary: monitor?.isPrimary,
        });

        if (!monitor) {
          throw new Error(`Monitor.fromDisplay(${display.id}) get null`);
        }

        const image = await withTimeout(
          monitor.captureImage(),
          4000,
          'node-screenshots capture timed out',
        );
        const buffer = await image.toPng(true);
        return nativeImage.createFromBuffer(buffer);
      } catch (err) {
        this.logger('SCREENSHOTS:capture Monitor capture() error %o', err);
      }
    }

    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: display.width * display.scaleFactor,
          height: display.height * display.scaleFactor,
        },
      }),
      4000,
      'desktopCapturer capture timed out',
    );

    let source: DesktopCapturerSource | undefined;
    // Linux系统上，screen.getDisplayNearestPoint 返回的 Display 对象的 id
    // 和这里 source 对象上的 display_id(Linux上，这个值是空字符串) 或 id 的中间部分，都不一致
    // 但是，如果只有一个显示器的话，其实不用判断，直接返回就行
    if (sources.length === 1) {
      [source] = sources;
    } else {
      source = sources.find(
        (item) =>
          item.display_id === display.id.toString() ||
          item.id.startsWith(`screen:${display.id}:`),
      );
    }

    if (!source) {
      this.logger(
        "SCREENSHOTS:capture Can't find screen source. sources: %o, display: %o",
        sources,
        display,
      );
      throw new Error("Can't find screen source");
    }

    return source.thumbnail;
  }

  private sendLongScreenshotProgress(progress: {
    state: string;
    message?: string;
    frameCount?: number;
    warnings?: string[];
  }) {
    this.$view.webContents.send('SCREENSHOTS:longScreenshot-progress', progress);
  }

  private async startLongScreenshot(data: ScreenshotsData): Promise<void> {
    this.logger('SCREENSHOTS:longScreenshot-start %o', data);

    if (this.longScreenshotSession) {
      this.longScreenshotSession.cancel();
    }

    const startEvent = new Event();
    this.emit('longScreenshotStart', startEvent, data);
    if (startEvent.defaultPrevented) {
      return;
    }

    const frames: ScrollshotFrame[] = [];
    const warnings: string[] = [];
    let cancelled = false;
    let finishing = false;
    let captureBusy = false;
    let frameTimer: ReturnType<typeof setInterval> | null = null;
    const registeredAccelerators: string[] = [];

    const cleanup = () => {
      if (frameTimer) {
        clearInterval(frameTimer);
        frameTimer = null;
      }
      for (const accelerator of registeredAccelerators) {
        globalShortcut.unregister(accelerator);
      }
      this.longScreenshotSession = null;
    };

    const captureFrame = async (force = false) => {
      if (cancelled || (!force && finishing) || captureBusy) {
        return;
      }
      captureBusy = true;
      try {
        const fullImage = await this.captureNativeImage(data.display);
        const cropped = cropNativeImageByDipBounds(
          fullImage,
          data.bounds,
          data.display,
        );
        frames.push({
          image: nativeImageToPixelImage(cropped.image),
          index: frames.length,
          timestamp: Date.now(),
          deviceScaleFactor: cropped.scaleFactor,
          captureRect: data.bounds,
        });
        this.sendLongScreenshotProgress({
          state: 'capturing',
          frameCount: frames.length,
          message: `长截图采集中：已捕获 ${frames.length} 帧。滚动完成后按 Enter，按 Esc 取消。`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`capture failure: ${message}`);
        this.logger('SCREENSHOTS:longScreenshot capture failure %o', err);
      } finally {
        captureBusy = false;
      }
    };

    const finish = async () => {
      if (finishing || cancelled) {
        return;
      }
      finishing = true;
      await captureFrame(true);
      cleanup();

      if (frames.length < 2) {
        const message = '长截图失败：捕获帧不足，至少需要 2 帧。';
        this.sendLongScreenshotProgress({
          state: 'failed',
          frameCount: frames.length,
          warnings,
          message,
        });
        this.emit('longScreenshotFailed', new Event(), data, message, warnings);
        await this.endCapture();
        return;
      }

      try {
        this.sendLongScreenshotProgress({
          state: 'stitching',
          frameCount: frames.length,
          message: '长截图拼接中...',
        });
        const result = stitchFrames(frames, {
          stickyHeaderRows: 'auto',
          minOverlapRatio: 0.16,
          maxOverlapRatio: 0.96,
          minScrollDelta: 3,
          minConfidence: 0.68,
          sampleColumns: 64,
          sampleRows: 220,
        });

        if (result.plan.failureReason) {
          const message = `长截图失败：${result.plan.failureReason}`;
          this.sendLongScreenshotProgress({
            state: 'failed',
            frameCount: frames.length,
            warnings: result.plan.warnings,
            message,
          });
          this.emit(
            'longScreenshotFailed',
            new Event(),
            data,
            message,
            result.plan.warnings,
            result.plan,
          );
          await this.endCapture();
          return;
        }

        const outputScaleFactor = frames[0]?.deviceScaleFactor ?? 1;
        const buffer = pixelImageToNativeImage(
          result.image,
          outputScaleFactor,
        ).toPNG();
        const okData: ScreenshotsData = {
          ...data,
          longScreenshot: true,
        };
        const event = new Event();
        this.emit('ok', event, buffer, okData);
        this.emit('longScreenshot', event, buffer, okData, result.plan);
        if (event.defaultPrevented) {
          return;
        }
        clipboard.writeImage(nativeImage.createFromBuffer(buffer));
        await this.endCapture();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger('SCREENSHOTS:longScreenshot stitch failure %o', err);
        this.sendLongScreenshotProgress({
          state: 'failed',
          frameCount: frames.length,
          warnings: [message],
          message: `长截图失败：${message}`,
        });
        this.emit('longScreenshotFailed', new Event(), data, message, warnings);
        await this.endCapture();
      }
    };

    const cancel = () => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      cleanup();
      this.sendLongScreenshotProgress({
        state: 'cancelled',
        frameCount: frames.length,
        message: '长截图已取消。',
      });
      this.emit('longScreenshotCancel', new Event(), data);
    };

    const registerShortcut = (
      accelerator: string,
      handler: () => void | Promise<void>,
    ) => {
      if (globalShortcut.isRegistered(accelerator)) {
        return;
      }
      if (globalShortcut.register(accelerator, handler)) {
        registeredAccelerators.push(accelerator);
      }
    };

    this.longScreenshotSession = { cancel, finish };

    registerShortcut('Enter', () => {
      finish();
    });
    registerShortcut('Esc', () => {
      cancel();
      this.endCapture();
    });

    this.sendLongScreenshotProgress({
      state: 'starting',
      frameCount: 0,
      message:
        '长截图模式即将开始。请在选区内滚动，按 Enter 完成，按 Esc 取消。',
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 900));
    this.$win?.hide();
    await new Promise<void>((resolve) => setTimeout(resolve, 180));
    await captureFrame();
    frameTimer = setInterval(() => {
      captureFrame();
      if (frames.length >= 80) {
        finish();
      }
    }, 300);
  }

  /**
   * 绑定ipc时间处理
   */
  private listenIpc(): void {
    /**
     * OK事件
     */
    ipcMain.on(
      'SCREENSHOTS:ok',
      (_event, buffer: Buffer, data: ScreenshotsData) => {
        this.logger(
          'SCREENSHOTS:ok buffer.length %d, data: %o',
          buffer.length,
          data,
        );

        const event = new Event();
        this.emit('ok', event, buffer, data);
        if (event.defaultPrevented) {
          return;
        }
        clipboard.writeImage(nativeImage.createFromBuffer(buffer));
        this.endCapture();
      },
    );
    /**
     * CANCEL事件
     */
    ipcMain.on('SCREENSHOTS:cancel', () => {
      this.logger('SCREENSHOTS:cancel');

      const event = new Event();
      this.emit('cancel', event);
      if (event.defaultPrevented) {
        return;
      }
      this.endCapture();
    });

    ipcMain.on(
      'SCREENSHOTS:longScreenshot-start',
      (_event, data: ScreenshotsData) => {
        this.startLongScreenshot(data).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger('SCREENSHOTS:longScreenshot-start error %o', err);
          this.sendLongScreenshotProgress({
            state: 'failed',
            message: `长截图失败：${message}`,
            warnings: [message],
          });
          this.emit(
            'longScreenshotFailed',
            new Event(),
            data,
            message,
            [message],
          );
        });
      },
    );

    /**
     * SAVE事件
     */
    ipcMain.on(
      'SCREENSHOTS:save',
      async (_event, buffer: Buffer, data: ScreenshotsData) => {
        this.logger(
          'SCREENSHOTS:save buffer.length %d, data: %o',
          buffer.length,
          data,
        );

        const event = new Event();
        this.emit('save', event, buffer, data);
        if (event.defaultPrevented || !this.$win) {
          return;
        }

        const time = new Date();
        const year = time.getFullYear();
        const month = padStart(time.getMonth() + 1, 2, '0');
        const date = padStart(time.getDate(), 2, '0');
        const hours = padStart(time.getHours(), 2, '0');
        const minutes = padStart(time.getMinutes(), 2, '0');
        const seconds = padStart(time.getSeconds(), 2, '0');
        const milliseconds = padStart(time.getMilliseconds(), 3, '0');

        this.$win.setAlwaysOnTop(false);

        const { canceled, filePath } = await dialog.showSaveDialog(this.$win, {
          defaultPath: `${year}${month}${date}${hours}${minutes}${seconds}${milliseconds}.png`,
          filters: [
            { name: 'Image (png)', extensions: ['png'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (!this.$win) {
          this.emit('afterSave', new Event(), buffer, data, false); // isSaved = false
          return;
        }

        this.$win.setAlwaysOnTop(true);
        if (canceled || !filePath) {
          this.emit('afterSave', new Event(), buffer, data, false); // isSaved = false
          return;
        }

        await fs.writeFile(filePath, buffer);
        this.emit('afterSave', new Event(), buffer, data, true); // isSaved = true
        this.endCapture();
      },
    );
  }
}
