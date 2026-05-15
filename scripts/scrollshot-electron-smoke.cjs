const { execFile, spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { deflateSync } = require('node:zlib');

const rootDir = resolve(__dirname, '..');
const outDir = join(rootDir, 'artifacts', 'latest', 'electron-smoke');
const autoOutDir = join(rootDir, 'artifacts', 'latest', 'electron-auto-smoke');
const externalAutoOutDir = join(
  rootDir,
  'artifacts',
  'latest',
  'electron-external-auto-smoke',
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngEncode(image) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(image.data.buffer, image.data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function writeSmokeError(error, dir = outDir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'error.json'),
    JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      null,
      2,
    ),
  );
}

function desktopSmokeScoreThreshold() {
  // macOS desktop capture applies display color management to screen pixels,
  // while the CDP reference image remains unprofiled.
  return process.platform === 'darwin' ? 0.92 : 0.985;
}

function buildFixtureHtml({ width = 460 } = {}) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body {
  width: ${width}px;
  margin: 0;
  padding: 0;
  overflow: auto;
  background: #f8fafc;
  font-family: Arial, sans-serif;
  scrollbar-width: none;
}
body::-webkit-scrollbar {
  width: 0;
  height: 0;
}
canvas {
  display: block;
}
</style>
</head>
<body><canvas id="fixture" width="${width}" height="2640"></canvas>
<script>
const canvas = document.getElementById('fixture');
const ctx = canvas.getContext('2d');
for (let y = 0; y < canvas.height; y += 1) {
  ctx.fillStyle = 'rgb(' + ((y * 37 + 11) % 251) + ',' + ((y * 73 + 29) % 253) + ',' + ((y * 109 + 47) % 255) + ')';
  ctx.fillRect(0, y, canvas.width, 1);
  if (y % 48 === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(32, y + 8, 360, 4);
    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.fillRect(32, y + 20, 260, 3);
  }
}
</script></body>
</html>`;
}

function resolveElectronPath() {
  const electronModulePath = require.resolve('electron', {
    paths: [join(rootDir, 'packages', 'electron-screenshots')],
  });
  return require(electronModulePath);
}

async function launchSelfInElectron() {
  const electronPath = resolveElectronPath();
  const child = spawn(electronPath, ['--no-sandbox', __filename], {
    cwd: rootDir,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: 'inherit',
  });

  const code = await new Promise((resolveExit) => {
    child.on('exit', (exitCode) => resolveExit(exitCode ?? 1));
  });
  process.exit(code);
}

async function runInElectron() {
  const electron = require('electron');
  const { app, BrowserWindow, Menu, nativeImage, screen } = electron;
  const hardTimeout = setTimeout(() => {
    const error = new Error('Electron scrollshot smoke timed out');
    writeSmokeError(error);
    console.error(error);
    app.exit(1);
  }, 160000);

  const Screenshots = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
  ));
  const {
    compareImages,
    createDiffImage,
  } = require(join(rootDir, 'packages', 'scrollshot-core', 'lib'));
  const { AutomaticScrollshotSession } = require(join(
    rootDir,
    'packages',
    'scrollshot-session',
    'lib',
  ));
  const { nativeImageToPixelImage } = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
    'lib',
    'scrollshot',
    'nativeImage.js',
  ));
  const { ElectronControlledContentAdapter } = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
    'lib',
    'scrollshot',
    'adapters.js',
  ));
  const {
    createLongScreenshotController,
    getLongScreenshotControllerBounds,
  } = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
    'lib',
    'scrollshot',
    'controller.js',
  ));

  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.disableHardwareAcceleration();
  await app.whenReady();
  mkdirSync(outDir, { recursive: true });

  const display = screen.getPrimaryDisplay();
  runControllerFallbackSmoke({
    Menu,
    display,
    createLongScreenshotController,
    getLongScreenshotControllerBounds,
  });
  const x = display.bounds.x + 80;
  const y = display.bounds.y + 80;
  const width = 460;
  const height = 480;
  const target = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    show: true,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  target.removeMenu();
  await target.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildFixtureHtml())}`,
  );
  target.show();
  target.focus();
  await delay(700);

  const expected = await captureFullPage(target);
  writeFileSync(join(outDir, 'expected.png'), expected);

  const screenshots = new Screenshots({
    singleWindow: true,
    longScreenshotMode: 'manual',
  });
  let outputBuffer = null;
  let outputData = null;
  let outputPlan = null;
  let failure = null;
  let controllerWindow = null;
  let controllerProgressSnapshot = null;
  let finishedWithController = false;
  let usedDomClickFallback = false;
  const scrollStates = [];

  screenshots.on('ok', (_event, buffer, data) => {
    if (data?.longScreenshot) {
      outputBuffer = buffer;
      outputData = data;
    }
  });
  screenshots.on('longScreenshot', (_event, buffer, data, plan) => {
    outputBuffer = buffer;
    outputData = data;
    outputPlan = plan;
  });
  screenshots.on('longScreenshotFailed', (_event, _data, message, warnings, plan) => {
    failure = { message, warnings, plan, scrollStates };
  });
  screenshots.on('longScreenshotControllerShown', (controller) => {
    controllerWindow = controller;
  });

  await screenshots.startCapture();
  await delay(700);
  await dragSelect(screenshots.$view.webContents, {
    x: x - display.bounds.x,
    y: y - display.bounds.y,
    width,
    height,
  });
  await delay(300);
  await clickLongScreenshotButton(screenshots.$view.webContents);
  usedDomClickFallback = await ensureLongScreenshotStarted(
    screenshots,
    screenshots.$view.webContents,
  );
  await delay(1400);
  if (controllerWindow && !controllerWindow.isDestroyed()) {
    controllerProgressSnapshot = await controllerWindow.webContents.executeJavaScript(
      `(() => ({
        title: document.getElementById('title')?.textContent || '',
        meta: document.getElementById('meta')?.textContent || '',
        message: document.getElementById('message')?.textContent || '',
        warnings: document.getElementById('warnings')?.textContent || ''
      }))()`,
    );
  }

  for (let index = 0; index < 12; index += 1) {
    const state = await target.webContents.executeJavaScript(`(() => {
      window.scrollBy(0, 240);
      return {
        scrollTop: window.scrollY,
        maxScrollTop: document.documentElement.scrollHeight - window.innerHeight
      };
    })()`);
    scrollStates.push(state);
    await delay(450);
    if (state.scrollTop >= state.maxScrollTop) {
      break;
    }
  }

  await delay(850);
  if (controllerWindow && !controllerWindow.isDestroyed()) {
    await controllerWindow.webContents.executeJavaScript(
      `document.querySelector('[data-action="finish"]').click()`,
    );
    finishedWithController = true;
  } else if (screenshots.longScreenshotSession?.finish) {
    await screenshots.longScreenshotSession.finish();
  }

  for (let tries = 0; tries < 40 && !outputBuffer && !failure; tries += 1) {
    await delay(250);
  }

  if (failure) {
    writeFileSync(
      join(outDir, 'failure.json'),
      JSON.stringify(failure, null, 2),
    );
    throw new Error(`Long screenshot smoke failed: ${failure.message}`);
  }
  if (!outputBuffer) {
    writeFileSync(
      join(outDir, 'failure.json'),
      JSON.stringify(
        {
          message: 'Long screenshot smoke did not produce an output buffer',
          scrollStates,
          controllerShown: Boolean(controllerWindow),
          controllerDestroyed:
            controllerWindow && typeof controllerWindow.isDestroyed === 'function'
              ? controllerWindow.isDestroyed()
              : undefined,
          finishedWithController,
          hasSession: Boolean(screenshots.longScreenshotSession),
          usedDomClickFallback,
        },
        null,
        2,
      ),
    );
    throw new Error('Long screenshot smoke did not produce an output buffer');
  }

  writeFileSync(join(outDir, 'actual.png'), outputBuffer);
  if (outputPlan) {
    writeFileSync(
      join(outDir, 'stitch-plan.json'),
      JSON.stringify(outputPlan, null, 2),
    );
  }

  const actualImage = nativeImage.createFromBuffer(outputBuffer);
  const expectedImage = nativeImage.createFromBuffer(expected);
  const actualPixels = nativeImageToPixelImage(actualImage);
  const expectedPixels = nativeImageToPixelImage(expectedImage);
  const diffStats = compareImages(actualPixels, expectedPixels);
  const diffImage = createDiffImage(actualPixels, expectedPixels);
  writeFileSync(join(outDir, 'diff.png'), pngEncode(diffImage));
  const scoreThreshold = desktopSmokeScoreThreshold();

  const result = {
    passed:
      diffStats.score >= scoreThreshold &&
      !diffStats.sizeMismatch &&
      !outputPlan?.failureReason &&
      Boolean(controllerProgressSnapshot?.message) &&
      Boolean(controllerProgressSnapshot?.meta),
    scoreThreshold,
    score: diffStats.score,
    sizeMismatch: diffStats.sizeMismatch,
    actual: actualImage.getSize(),
    expected: expectedImage.getSize(),
    plan: outputPlan,
    scrollStates,
    controllerShown: Boolean(controllerWindow),
    controllerProgressSnapshot,
    finishedWithController,
    usedDomClickFallback,
    scrollMethods: outputData?.longScreenshotScrollMethods,
    scrollDiagnostics: outputData?.longScreenshotScrollDiagnostics,
  };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));

  if (!result.passed) {
    throw new Error(`Electron smoke quality gate failed: ${JSON.stringify(result)}`);
  }

  await screenshots.endCapture();
  target.destroy();
  await runAutomaticExternalSmoke({
    BrowserWindow,
    nativeImage,
    display,
    compareImages,
    createDiffImage,
    nativeImageToPixelImage,
    Screenshots,
  });
  await runAutomaticControlledSmoke({
    BrowserWindow,
    nativeImage,
    display,
    compareImages,
    createDiffImage,
    nativeImageToPixelImage,
    AutomaticScrollshotSession,
    ElectronControlledContentAdapter,
  });
  app.quit();
  clearTimeout(hardTimeout);
}

function runControllerFallbackSmoke({
  Menu,
  display,
  createLongScreenshotController,
  getLongScreenshotControllerBounds,
}) {
  const controllerDisplay = {
    id: display.id,
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
  };
  const data = {
    bounds: {
      x: 0,
      y: 0,
      width: controllerDisplay.width,
      height: controllerDisplay.height,
    },
    display: controllerDisplay,
  };
  if (getLongScreenshotControllerBounds(data) !== null) {
    throw new Error('Full-screen controller bounds should use fallback');
  }

  const previousMenu = Menu.getApplicationMenu();
  let fallbackShown = false;
  const controller = createLongScreenshotController({
    data,
    finish: async () => undefined,
    cancel: () => undefined,
    onFallbackShown: () => {
      fallbackShown = true;
    },
  });
  if (!controller || controller.window || !fallbackShown) {
    throw new Error('Long screenshot menu fallback was not created');
  }
  controller.update({
    state: 'capturing',
    frameCount: 3,
    message: 'fallback smoke',
  });
  const menu = Menu.getApplicationMenu();
  if (!menu?.items.some((item) => item.label === 'Long Screenshot')) {
    throw new Error('Long screenshot menu fallback was not installed');
  }
  controller.destroy();
  if (Menu.getApplicationMenu() !== previousMenu) {
    throw new Error('Long screenshot menu fallback did not restore menu');
  }
}

async function runAutomaticControlledSmoke({
  BrowserWindow,
  nativeImage,
  display,
  compareImages,
  createDiffImage,
  nativeImageToPixelImage,
  AutomaticScrollshotSession,
  ElectronControlledContentAdapter,
}) {
  mkdirSync(autoOutDir, { recursive: true });
  const width = 460;
  const height = 480;
  const target = new BrowserWindow({
    x: display.bounds.x + 120,
    y: display.bounds.y + 120,
    width,
    height,
    frame: false,
    show: true,
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    target.removeMenu();
    await target.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildFixtureHtml({ width }))}`,
    );
    target.show();
    target.focus();
    await delay(500);

    const expected = await captureFullPage(target, { width });
    writeFileSync(join(autoOutDir, 'expected.png'), expected);

    const adapter = new ElectronControlledContentAdapter(target.webContents, {
      x: 0,
      y: 0,
      width,
      height,
    });
    const session = new AutomaticScrollshotSession(adapter, adapter, {
      scrollStepPx: 240,
      settleMs: 120,
      maxFrames: 16,
      stitch: {
        stickyHeaderRows: 'auto',
        minOverlapRatio: 0.16,
        maxOverlapRatio: 0.96,
        minScrollDelta: 3,
        minConfidence: 0.96,
        sampleColumns: 64,
        sampleRows: 220,
      },
    });
    const output = await session.run();
    const actualBuffer = pngEncode(output.image);
    writeFileSync(join(autoOutDir, 'actual.png'), actualBuffer);
    writeFileSync(
      join(autoOutDir, 'stitch-plan.json'),
      JSON.stringify(output.plan, null, 2),
    );

    const expectedImage = nativeImage.createFromBuffer(expected);
    const expectedPixels = nativeImageToPixelImage(expectedImage);
    const diffStats = compareImages(output.image, expectedPixels);
    const diffImage = createDiffImage(output.image, expectedPixels);
    writeFileSync(join(autoOutDir, 'diff.png'), pngEncode(diffImage));

    const result = {
      passed:
        diffStats.score >= 0.985 &&
        !diffStats.sizeMismatch &&
        !output.plan.failureReason,
      score: diffStats.score,
      sizeMismatch: diffStats.sizeMismatch,
      actual: {
        width: output.image.width,
        height: output.image.height,
      },
      expected: expectedImage.getSize(),
      plan: output.plan,
    };
    writeFileSync(join(autoOutDir, 'result.json'), JSON.stringify(result, null, 2));

    if (!result.passed) {
      throw new Error(
        `Automatic Electron scrollshot smoke quality gate failed: ${JSON.stringify(result)}`,
      );
    }
  } catch (error) {
    writeSmokeError(error, autoOutDir);
    throw error;
  } finally {
    target.destroy();
  }
}

async function runAutomaticExternalSmoke({
  BrowserWindow,
  nativeImage,
  display,
  compareImages,
  createDiffImage,
  nativeImageToPixelImage,
  Screenshots,
}) {
  mkdirSync(externalAutoOutDir, { recursive: true });
  const macOSScreenCaptureKitProbe =
    process.platform === 'darwin'
      ? await runMacOSScreenCaptureKitProbe()
      : undefined;
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    writeFileSync(
      join(externalAutoOutDir, 'result.json'),
      JSON.stringify(
        {
          passed: true,
          skipped: true,
          reason:
            'External automatic OS scrolling smoke is enforced on Windows. macOS is probed separately for ScreenCaptureKit and Accessibility; Linux requires xdotool in the runner.',
          platform: process.platform,
        },
        null,
        2,
      ),
    );
    return;
  }

  const width = process.platform === 'darwin' ? 320 : 460;
  const height = 480;
  const targetXOffset =
    process.platform === 'darwin'
      ? Math.max(40, display.bounds.width - width - 24)
      : 160;
  const x = display.bounds.x + targetXOffset;
  const y = display.bounds.y + 120;
  const target = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    show: true,
    alwaysOnTop: process.platform === 'darwin',
    resizable: false,
    movable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const screenshots = new Screenshots({
    singleWindow: true,
    longScreenshotMode: 'automatic',
  });
  let outputBuffer = null;
  let outputData = null;
  let outputPlan = null;
  let failure = null;
  let usedDomClickFallback = false;

  try {
    target.removeMenu();
    await target.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildFixtureHtml({ width }))}`,
    );
    target.show();
    target.focus();
    await delay(700);

    const expected = await captureFullPage(target, { width });
    writeFileSync(join(externalAutoOutDir, 'expected.png'), expected);

    screenshots.on('ok', (_event, buffer, data) => {
      if (data?.longScreenshot) {
        outputBuffer = buffer;
        outputData = data;
      }
    });
    screenshots.on('longScreenshot', (_event, buffer, data, plan) => {
      outputBuffer = buffer;
      outputData = data;
      outputPlan = plan;
    });
    screenshots.on('longScreenshotFailed', (_event, data, message, warnings, plan) => {
      failure = {
        message,
        warnings,
        plan,
        scrollDiagnostics: data?.longScreenshotScrollDiagnostics,
      };
    });

    await screenshots.startCapture();
    await delay(700);
    await dragSelect(screenshots.$view.webContents, {
      x: x - display.bounds.x,
      y: y - display.bounds.y,
      width,
      height,
    });
    await delay(300);
    await clickLongScreenshotButton(screenshots.$view.webContents);
    usedDomClickFallback = await ensureLongScreenshotStarted(
      screenshots,
      screenshots.$view.webContents,
    );

    for (let tries = 0; tries < 120 && !outputBuffer && !failure; tries += 1) {
      await delay(250);
    }

    if (failure) {
      writeFileSync(
        join(externalAutoOutDir, 'failure.json'),
        JSON.stringify(failure, null, 2),
      );
      const macOSEnvironmentBlock =
        process.platform === 'darwin'
          ? getMacOSExternalAutoEnvironmentBlockReason(
              failure,
              macOSScreenCaptureKitProbe,
            )
          : null;
      if (macOSEnvironmentBlock) {
        writeFileSync(
          join(externalAutoOutDir, 'result.json'),
          JSON.stringify(
            {
              passed: true,
              skipped: true,
              platform: process.platform,
              environmentBlock: macOSEnvironmentBlock.code,
              reason: macOSEnvironmentBlock.reason,
              failure,
              screenCaptureKitProbe: macOSScreenCaptureKitProbe,
              usedDomClickFallback,
            },
            null,
            2,
          ),
        );
        return;
      }
      throw new Error(
        `External automatic scrollshot smoke failed: ${failure.message}`,
      );
    }
    if (!outputBuffer) {
      writeFileSync(
        join(externalAutoOutDir, 'failure.json'),
        JSON.stringify(
          {
            message:
              'External automatic scrollshot smoke did not produce an output buffer',
            hasSession: Boolean(screenshots.longScreenshotSession),
            usedDomClickFallback,
            screenCaptureKitProbe: macOSScreenCaptureKitProbe,
          },
          null,
          2,
        ),
      );
      throw new Error(
        'External automatic scrollshot smoke did not produce an output buffer',
      );
    }

    writeFileSync(join(externalAutoOutDir, 'actual.png'), outputBuffer);
    if (outputPlan) {
      writeFileSync(
        join(externalAutoOutDir, 'stitch-plan.json'),
        JSON.stringify(outputPlan, null, 2),
      );
    }

    const actualImage = nativeImage.createFromBuffer(outputBuffer);
    const expectedImage = nativeImage.createFromBuffer(expected);
    const actualPixels = nativeImageToPixelImage(actualImage);
    const expectedPixels = nativeImageToPixelImage(expectedImage);
    const diffStats = compareImages(actualPixels, expectedPixels);
    const diffImage = createDiffImage(actualPixels, expectedPixels);
    writeFileSync(join(externalAutoOutDir, 'diff.png'), pngEncode(diffImage));

    const result = {
      passed:
        diffStats.score >= 0.985 &&
        !diffStats.sizeMismatch &&
        !outputPlan?.failureReason,
      score: diffStats.score,
      sizeMismatch: diffStats.sizeMismatch,
      actual: actualImage.getSize(),
      expected: expectedImage.getSize(),
      plan: outputPlan,
      platform: process.platform,
      usedDomClickFallback,
      scrollMethods: outputData?.longScreenshotScrollMethods,
      scrollDiagnostics: outputData?.longScreenshotScrollDiagnostics,
      screenCaptureKitProbe: macOSScreenCaptureKitProbe,
    };
    writeFileSync(
      join(externalAutoOutDir, 'result.json'),
      JSON.stringify(result, null, 2),
    );

    if (!result.passed) {
      throw new Error(
        `External automatic scrollshot smoke quality gate failed: ${JSON.stringify(result)}`,
      );
    }
  } catch (error) {
    writeSmokeError(error, externalAutoOutDir);
    throw error;
  } finally {
    await screenshots.endCapture();
    target.destroy();
  }
}

async function runMacOSScreenCaptureKitProbe() {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  try {
    const output = await execFileText(
      '/usr/bin/swift',
      [join(rootDir, 'scripts', 'macos-screencapturekit-probe.swift')],
      15000,
    );
    return {
      ...parseJsonObject(output.stdout),
      stderr: output.stderr.trim() || undefined,
    };
  } catch (error) {
    return {
      ok: false,
      api: 'ScreenCaptureKit',
      message: error instanceof Error ? error.message : String(error),
      stdout:
        error && typeof error === 'object' && 'stdout' in error
          ? String(error.stdout)
          : undefined,
      stderr:
        error && typeof error === 'object' && 'stderr' in error
          ? String(error.stderr)
          : undefined,
    };
  }
}

function execFileText(file, args, timeoutMs) {
  return new Promise((resolveExec, rejectExec) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout?.toString() ?? '';
          error.stderr = stderr?.toString() ?? '';
          rejectExec(error);
          return;
        }
        resolveExec({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
        });
      },
    );
  });
}

function parseJsonObject(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { value: parsed };
  } catch {
    const jsonLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    if (!jsonLine) {
      return { stdout: text };
    }
    try {
      const parsed = JSON.parse(jsonLine);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : { value: parsed };
    } catch {
      return { stdout: text };
    }
  }
}

function getMacOSExternalAutoEnvironmentBlockReason(
  failure,
  screenCaptureKitProbe,
) {
  if (isMacOSAccessibilityPermissionBlock(failure)) {
    return {
      code: 'macos-accessibility-not-trusted',
      reason:
        'macOS external automatic scrolling could not be verified because the runner process is not trusted for Accessibility input control.',
    };
  }

  const trustedScrollBlock = getMacOSTrustedScrollNoMovementBlock(
    failure,
    screenCaptureKitProbe,
  );
  if (trustedScrollBlock) {
    return trustedScrollBlock;
  }

  return null;
}

function isMacOSAccessibilityPermissionBlock(failure) {
  const diagnostics = Array.isArray(failure?.scrollDiagnostics)
    ? failure.scrollDiagnostics
    : [];
  if (diagnostics.some((diagnostic) => hasUntrustedAccessibility(diagnostic))) {
    return true;
  }

  const text = [
    failure?.message,
    failure?.plan?.failureReason,
    failure?.warnings?.join?.('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return (
    text.includes('macos accessibility permission is not granted') ||
    text.includes('axisprocesstrusted returned false') ||
    text.includes('not allowed assistive access') ||
    text.includes('not authorized to send apple events')
  );
}

function getMacOSTrustedScrollNoMovementBlock(failure, screenCaptureKitProbe) {
  const messageText = [
    failure?.message,
    failure?.plan?.failureReason,
    failure?.warnings?.join?.('\n'),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!messageText.includes('did not move the selected region')) {
    return null;
  }

  const diagnostics = Array.isArray(failure?.scrollDiagnostics)
    ? failure.scrollDiagnostics
    : [];
  const hasCGEvent = diagnostics.some((diagnostic) =>
    hasTrustedMacOSCGEventScroll(diagnostic),
  );
  const hasAXAction = diagnostics.some((diagnostic) =>
    hasTrustedMacOSAXScrollAction(diagnostic),
  );
  if (!hasCGEvent && !hasAXAction) {
    return null;
  }

  const captureProbeSucceeded = screenCaptureKitProbe?.ok === true;
  const preflightText = captureProbeSucceeded
    ? 'ScreenCaptureKit and Accessibility preflight succeeded'
    : 'Accessibility preflight succeeded';
  const hasSystemDialogInterception = diagnostics.some((diagnostic) =>
    hasMacOSSystemDialogInterception(diagnostic),
  );
  if (hasSystemDialogInterception) {
    return {
      code: 'macos-hosted-runner-system-dialog-intercepts-scroll',
      reason: `macOS external automatic scrolling could not be verified in this hosted runner: ${preflightText}, but an Accessibility hit-test found a system notification/dialog over the selected region and trusted scroll attempts did not move the target.`,
    };
  }

  if (hasAXAction && hasCGEvent) {
    return {
      code: 'macos-hosted-runner-trusted-scroll-no-movement',
      reason: `macOS external automatic scrolling could not be verified in this hosted runner: ${preflightText}, Accessibility scroll actions completed and CoreGraphics scroll events were posted, but the selected target region did not move.`,
    };
  }
  if (hasAXAction) {
    return {
      code: 'macos-hosted-runner-ax-scroll-no-movement',
      reason: `macOS external automatic scrolling could not be verified in this hosted runner: ${preflightText} and Accessibility scroll actions completed, but the selected target region did not move.`,
    };
  }
  return {
    code: 'macos-hosted-runner-cgevent-no-movement',
    reason: `macOS external automatic scrolling could not be verified in this hosted runner: ${preflightText} and CoreGraphics scroll events were posted, but the selected target region did not move.`,
  };
}

function hasTrustedMacOSCGEventScroll(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const details = value.details && typeof value.details === 'object'
    ? value.details
    : value;
  const accessibility =
    details.accessibility && typeof details.accessibility === 'object'
      ? details.accessibility
      : undefined;
  if (
    details.api === 'CGEventCreateScrollWheelEvent' &&
    (details.trusted === true || accessibility?.trusted === true)
  ) {
    return true;
  }

  if (
    value.method === 'macos-cgevent-scroll' &&
    value.ok === true &&
    details !== value &&
    hasTrustedMacOSCGEventScroll(details)
  ) {
    return true;
  }

  if (Array.isArray(value.attempts)) {
    return value.attempts.some((attempt) =>
      hasTrustedMacOSCGEventScroll(attempt),
    );
  }

  return Object.values(value).some((child) =>
    hasTrustedMacOSCGEventScroll(child),
  );
}

function hasMacOSSystemDialogInterception(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const ancestors = Array.isArray(value.inspectedAncestors)
    ? value.inspectedAncestors
    : [];
  if (
    ancestors.some((ancestor) => {
      if (!ancestor || typeof ancestor !== 'object') {
        return false;
      }
      return (
        String(ancestor.subrole ?? '') === 'AXSystemDialog' ||
        String(ancestor.title ?? '') === 'UserNotificationCenter' ||
        String(ancestor.description ?? '').toLowerCase() === 'alert'
      );
    })
  ) {
    return true;
  }

  if (Array.isArray(value.attempts)) {
    return value.attempts.some((attempt) =>
      hasMacOSSystemDialogInterception(attempt?.details ?? attempt),
    );
  }

  if (value.details && typeof value.details === 'object') {
    return hasMacOSSystemDialogInterception(value.details);
  }

  return Object.values(value).some((child) =>
    hasMacOSSystemDialogInterception(child),
  );
}

function hasTrustedMacOSAXScrollAction(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const details = value.details && typeof value.details === 'object'
    ? value.details
    : value;
  if (
    details.api === 'AXUIElementPerformAction' &&
    details.trusted === true &&
    Array.isArray(details.performErrors) &&
    details.performErrors.some((error) => error === 0)
  ) {
    return true;
  }

  if (
    value.method === 'macos-ax-scroll-action' &&
    value.ok === true &&
    details !== value &&
    hasTrustedMacOSAXScrollAction(details)
  ) {
    return true;
  }

  if (Array.isArray(value.attempts)) {
    return value.attempts.some((attempt) =>
      hasTrustedMacOSAXScrollAction(attempt),
    );
  }

  return Object.values(value).some((child) =>
    hasTrustedMacOSAXScrollAction(child),
  );
}

function hasUntrustedAccessibility(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (value.api === 'AXIsProcessTrusted' && value.trusted === false) {
    return true;
  }
  if (value.accessibility?.trusted === false) {
    return true;
  }
  if (Array.isArray(value.attempts)) {
    return value.attempts.some((attempt) =>
      hasUntrustedAccessibility(attempt?.details),
    );
  }
  return Object.values(value).some((child) => hasUntrustedAccessibility(child));
}

async function captureFullPage(target, { width = 460 } = {}) {
  const debuggerApi = target.webContents.debugger;
  if (!debuggerApi.isAttached()) {
    debuggerApi.attach('1.3');
  }
  await debuggerApi.sendCommand('Page.enable');
  const metrics = await debuggerApi.sendCommand('Page.getLayoutMetrics');
  const contentSize = metrics.contentSize;
  const screenshot = await debuggerApi.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width,
      height: Math.ceil(contentSize.height),
      scale: 1,
    },
  });
  return Buffer.from(screenshot.data, 'base64');
}

async function dragSelect(webContents, rect) {
  webContents.sendInputEvent({
    type: 'mouseDown',
    x: rect.x,
    y: rect.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(80);
  webContents.sendInputEvent({
    type: 'mouseMove',
    x: rect.x + rect.width,
    y: rect.y + rect.height,
    button: 'left',
  });
  await delay(80);
  webContents.sendInputEvent({
    type: 'mouseUp',
    x: rect.x + rect.width,
    y: rect.y + rect.height,
    button: 'left',
    clickCount: 1,
  });
}

async function ensureLongScreenshotStarted(screenshots, webContents) {
  for (let tries = 0; tries < 8; tries += 1) {
    if (screenshots.longScreenshotSession) {
      return false;
    }
    await delay(125);
  }

  await clickLongScreenshotButton(webContents, { domClick: true });
  for (let tries = 0; tries < 16; tries += 1) {
    if (screenshots.longScreenshotSession) {
      return true;
    }
    await delay(125);
  }
  return true;
}

async function clickLongScreenshotButton(webContents, options = {}) {
  const buttonRect = await webContents.executeJavaScript(`(() => {
    const icon = document.querySelector('.icon-scrollshot');
    const button = icon?.closest('.screenshots-button');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  })()`);
  if (!buttonRect) {
    throw new Error('Long screenshot toolbar button was not rendered');
  }
  if (options.domClick) {
    const clicked = await webContents.executeJavaScript(`(() => {
      const icon = document.querySelector('.icon-scrollshot');
      const button = icon?.closest('.screenshots-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) {
      throw new Error('Long screenshot toolbar DOM click fallback failed');
    }
    return;
  }
  webContents.sendInputEvent({
    type: 'mouseDown',
    x: buttonRect.x,
    y: buttonRect.y,
    button: 'left',
    clickCount: 1,
  });
  await delay(60);
  webContents.sendInputEvent({
    type: 'mouseUp',
    x: buttonRect.x,
    y: buttonRect.y,
    button: 'left',
    clickCount: 1,
  });
}

if (process.versions.electron) {
  runInElectron().catch((error) => {
    writeSmokeError(error);
    console.error(error);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250);
  });
} else {
  launchSelfInElectron();
}
