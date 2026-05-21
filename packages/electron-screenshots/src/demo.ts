/* eslint-disable no-console */
import { app, BrowserWindow, globalShortcut } from 'electron';
import type { StitchPlan, StitchPlanFrame } from 'scrollshot-core';
import Screenshots from './index.js';

app.whenReady().then(() => {
  const screenshots = new Screenshots({
    lang: {
      operation_rectangle_title: '矩形2323',
    },
    singleWindow: true,
  });
  screenshots.$view.webContents.openDevTools();

  globalShortcut.register('ctrl+shift+a', () => {
    screenshots.startCapture();
  });

  screenshots.on('windowCreated', ($win) => {
    $win.on('focus', () => {
      globalShortcut.register('esc', () => {
        if ($win?.isFocused()) {
          screenshots.endCapture();
        }
      });
    });

    $win.on('blur', () => {
      globalShortcut.unregister('esc');
    });
  });

  // 防止不能关闭截图界面
  globalShortcut.register('ctrl+shift+q', () => {
    app.quit();
  });

  // 点击确定按钮回调事件
  screenshots.on('ok', (_event, buffer, bounds) => {
    console.log('capture', buffer, bounds);
  });
  // 点击取消按钮回调事件
  screenshots.on('cancel', () => {
    console.log('capture', 'cancel1');
    screenshots.setLang({
      operation_ellipse_title: 'ellipse',
      operation_rectangle_title: 'rectangle',
    });
  });
  // 点击保存按钮回调事件
  screenshots.on('save', (_event, buffer, bounds) => {
    console.log('capture', buffer, bounds);
  });

  screenshots.on('longScreenshotControllerShown', (win, lsData) => {
    console.log('long screenshot controller bounds', win.getBounds(), {
      selection: lsData.bounds,
      display: lsData.display,
    });
  });
  screenshots.on('longScreenshot', (_e, buffer, _data, plan: StitchPlan) => {
    console.log('long screenshot done', {
      bytes: buffer.length,
      stickyHeaderRows: plan.stickyHeaderRows,
      frameCount: plan.frameCount,
      accepted: plan.acceptedFrameCount,
      discardedDuplicate: plan.discardedDuplicateFrames.length,
      discardedTransient: plan.discardedTransientFrames.length,
      seamRows: plan.seamRows,
      frames: plan.frames.map((f: StitchPlanFrame) => ({
        idx: f.inputIndex,
        deltaY: f.deltaY,
        confidence: Number(f.confidence.toFixed(3)),
        score: f.score !== undefined ? Number(f.score.toFixed(4)) : undefined,
        rev: f.reverseScore !== undefined
          ? Number(f.reverseScore.toFixed(4))
          : undefined,
        sourceY: f.sourceY,
        rows: f.rows,
        dup: f.discardedDuplicate ? 1 : 0,
        trans: f.discardedTransient ? 1 : 0,
        warn: f.warnings.length > 0 ? f.warnings.join('; ') : undefined,
      })),
      warnings: plan.warnings,
    });
  });
  screenshots.on('longScreenshotFailed', (_e, _data, message, warnings) => {
    console.log('long screenshot failed', { message, warnings });
  });

  const mainWin = new BrowserWindow({
    show: true,
  });
  mainWin.removeMenu();
  mainWin.loadURL('https://github.com/nashaofu');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
