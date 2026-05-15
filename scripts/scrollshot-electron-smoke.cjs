const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { deflateSync } = require('node:zlib');

const rootDir = resolve(__dirname, '..');
const outDir = join(rootDir, 'artifacts', 'latest', 'electron-smoke');

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

function writeSmokeError(error) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'error.json'),
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

function buildFixtureHtml() {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body {
  width: 460px;
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
<body><canvas id="fixture" width="460" height="2640"></canvas>
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
  const { app, BrowserWindow, nativeImage, screen } = electron;
  const hardTimeout = setTimeout(() => {
    const error = new Error('Electron scrollshot smoke timed out');
    writeSmokeError(error);
    console.error(error);
    app.exit(1);
  }, 90000);

  const Screenshots = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
  ));
  const {
    compareImages,
    createDiffImage,
  } = require(join(rootDir, 'packages', 'scrollshot-core', 'lib'));
  const { nativeImageToPixelImage } = require(join(
    rootDir,
    'packages',
    'electron-screenshots',
    'lib',
    'scrollshot',
    'nativeImage.js',
  ));

  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.disableHardwareAcceleration();
  await app.whenReady();
  mkdirSync(outDir, { recursive: true });

  const display = screen.getPrimaryDisplay();
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

  const screenshots = new Screenshots({ singleWindow: true });
  let outputBuffer = null;
  let outputPlan = null;
  let failure = null;
  const scrollStates = [];

  screenshots.on('ok', (_event, buffer, data) => {
    if (data?.longScreenshot) {
      outputBuffer = buffer;
    }
  });
  screenshots.on('longScreenshot', (_event, buffer, _data, plan) => {
    outputBuffer = buffer;
    outputPlan = plan;
  });
  screenshots.on('longScreenshotFailed', (_event, _data, message, warnings, plan) => {
    failure = { message, warnings, plan, scrollStates };
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
  await delay(1400);

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
  if (screenshots.longScreenshotSession?.finish) {
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
    scrollStates,
  };
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(result, null, 2));

  await screenshots.endCapture();
  target.destroy();
  app.quit();
  clearTimeout(hardTimeout);

  if (!result.passed) {
    throw new Error(`Electron smoke quality gate failed: ${JSON.stringify(result)}`);
  }
}

async function captureFullPage(target) {
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
      width: 460,
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

async function clickLongScreenshotButton(webContents) {
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
