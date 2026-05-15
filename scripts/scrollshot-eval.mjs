import { deflateSync } from "node:zlib";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compareImages,
  createDiffImage,
  createPixelImage,
  cropPixelImage,
  paintRect,
  pixelOffset,
  stitchFrames,
} from "../packages/scrollshot-core/lib/index.js";

const outDir = join(process.cwd(), "artifacts", "latest");
const fixturesDir = join(outDir, "fixtures");
const frameViewportHeight = 560;
const frameWidth = 420;
const qualityGate = {
  overallScore: 0.985,
  criticalFailures: 0,
  missingRows: 0,
  duplicatedRows: 0,
  badSeams: 0,
  markerCoverage: 0.999,
};

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
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writePng(path, image) {
  await writeFile(path, pngEncode(image));
}

function colorFor(seed, row) {
  return {
    r: (seed * 53 + row * 17) % 256,
    g: (seed * 97 + row * 7) % 256,
    b: (seed * 193 + row * 13) % 256,
    a: 255,
  };
}

function paintHorizontalRule(image, y, color) {
  paintRect(image, 0, y, image.width, 1, color);
}

function paintMarkerRow(image, y, marker) {
  const r = marker & 255;
  const g = (marker >> 8) & 255;
  const b = (marker >> 16) & 255;
  paintRect(image, 0, y, image.width, 1, { r, g, b, a: 255 });
  paintRect(image, 0, y, 28, 12, { r, g, b, a: 255 });
}

function addStructuredContent(image, seed, startY = 0, endY = image.height) {
  for (let y = startY; y < endY; y += 1) {
    const color = colorFor(seed, y);
    paintHorizontalRule(image, y, color);
  }

  for (let block = 0; block < Math.ceil((endY - startY) / 120); block += 1) {
    const y = startY + block * 120 + 18;
    const accent = colorFor(seed + 11, block);
    paintRect(image, 28, y, image.width - 56, 54, {
      r: Math.floor((accent.r + 245) / 2),
      g: Math.floor((accent.g + 245) / 2),
      b: Math.floor((accent.b + 245) / 2),
      a: 255,
    });
    paintRect(image, 44, y + 12, image.width - 88, 4, accent);
    paintRect(image, 44, y + 26, image.width - 150, 4, {
      r: 44,
      g: 52,
      b: 63,
      a: 255,
    });
    paintRect(image, 44, y + 40, image.width - 210, 4, {
      r: 84,
      g: 91,
      b: 101,
      a: 255,
    });
  }
}

function createExpected(name, options) {
  const image = createPixelImage(options.width, options.height, {
    r: 250,
    g: 251,
    b: 252,
    a: 255,
  });

  if (name === "striped-markers") {
    const stripeHeight = 16;
    for (let y = 0; y < image.height; y += stripeHeight) {
      const marker = Math.floor(y / stripeHeight);
      const color = colorFor(7, marker);
      paintRect(image, 0, y, image.width, stripeHeight, {
        r: Math.floor((color.r + 220) / 2),
        g: Math.floor((color.g + 220) / 2),
        b: Math.floor((color.b + 220) / 2),
        a: 255,
      });
      paintMarkerRow(image, y, marker);
      paintRect(image, 46, y + 5, image.width - 92, 2, {
        r: 20,
        g: 28,
        b: 38,
        a: 255,
      });
    }
    return image;
  }

  if (name === "sticky-header") {
    paintRect(image, 0, 0, image.width, options.stickyHeaderRows, {
      r: 28,
      g: 42,
      b: 58,
      a: 255,
    });
    paintRect(image, 24, 16, image.width - 48, 6, {
      r: 240,
      g: 247,
      b: 255,
      a: 255,
    });
    paintRect(image, 24, 34, image.width - 180, 4, {
      r: 173,
      g: 202,
      b: 228,
      a: 255,
    });
    addStructuredContent(image, 12, options.stickyHeaderRows, image.height);
    return image;
  }

  if (name === "lazy-images") {
    addStructuredContent(image, 21);
    for (let y = 96; y < image.height; y += 360) {
      paintRect(image, 34, y, image.width - 68, 170, {
        r: 232,
        g: 238,
        b: 246,
        a: 255,
      });
      paintRect(image, 56, y + 22, image.width - 112, 126, colorFor(33, y));
      paintRect(image, 72, y + 44, image.width - 180, 8, {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
      });
    }
    return image;
  }

  if (name === "nested-scroll") {
    addStructuredContent(image, 42);
    for (let y = 180; y < image.height; y += 500) {
      paintRect(image, 40, y, image.width - 80, 260, {
        r: 247,
        g: 248,
        b: 250,
        a: 255,
      });
      paintRect(image, image.width - 62, y + 14, 8, 232, {
        r: 184,
        g: 196,
        b: 208,
        a: 255,
      });
      for (let item = 0; item < 5; item += 1) {
        paintRect(image, 64, y + 30 + item * 42, image.width - 148, 26, colorFor(51, y + item));
      }
    }
    return image;
  }

  if (name === "virtualized-list") {
    for (let row = 0; row < Math.floor(image.height / 44); row += 1) {
      const y = row * 44;
      paintRect(image, 0, y, image.width, 44, row % 2 === 0
        ? { r: 246, g: 248, b: 250, a: 255 }
        : { r: 255, g: 255, b: 255, a: 255 });
      paintRect(image, 24, y + 10, 32, 24, colorFor(61, row));
      paintRect(image, 76, y + 14, image.width - 140, 4, {
        r: 54,
        g: 65,
        b: 78,
        a: 255,
      });
      paintRect(image, 76, y + 25, image.width - 220, 3, {
        r: 141,
        g: 151,
        b: 163,
        a: 255,
      });
    }
    return image;
  }

  if (name === "chat-history-like") {
    for (let y = 0; y < image.height; y += 1) {
      paintHorizontalRule(image, y, { r: 239, g: 243, b: 248, a: 255 });
    }
    for (let message = 0; message < 42; message += 1) {
      const y = 28 + message * 64;
      const mine = message % 3 === 0;
      const width = 170 + (message % 5) * 32;
      const x = mine ? image.width - width - 24 : 24;
      paintRect(image, x, y, width, 42, mine
        ? { r: 212, g: 232, b: 255, a: 255 }
        : { r: 255, g: 255, b: 255, a: 255 });
      paintRect(image, x + 16, y + 12, width - 32, 4, colorFor(71, message));
      paintRect(image, x + 16, y + 25, width - 70, 3, {
        r: 92,
        g: 104,
        b: 117,
        a: 255,
      });
    }
    return image;
  }

  if (name === "pdf-like") {
    for (let page = 0; page < 5; page += 1) {
      const y = 28 + page * 640;
      paintRect(image, 34, y, image.width - 68, 590, {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
      });
      paintRect(image, 70, y + 50, image.width - 140, 8, {
        r: 35,
        g: 46,
        b: 58,
        a: 255,
      });
      for (let line = 0; line < 24; line += 1) {
        paintRect(image, 70, y + 92 + line * 18, image.width - 150 - (line % 4) * 24, 4, {
          r: 105,
          g: 114,
          b: 125,
          a: 255,
        });
      }
    }
    return image;
  }

  addStructuredContent(image, name === "high-dpi-scale" ? 91 : 5);
  return image;
}

function createFrames(expected, fixture) {
  const frames = [];
  const stickyRows = fixture.stickyHeaderRows ?? 0;
  const contentHeight = expected.height - stickyRows;
  const viewportContentHeight = fixture.viewportHeight - stickyRows;
  const maxScrollTop = Math.max(0, contentHeight - viewportContentHeight);
  const step = fixture.scrollStep;
  const scrollTops = [];

  for (let scrollTop = 0; scrollTop < maxScrollTop; scrollTop += step) {
    scrollTops.push(scrollTop);
  }
  if (scrollTops[scrollTops.length - 1] !== maxScrollTop) {
    scrollTops.push(maxScrollTop);
  }

  for (let index = 0; index < scrollTops.length; index += 1) {
    const scrollTop = scrollTops[index];
    let frame;
    if (stickyRows > 0) {
      frame = createPixelImage(fixture.width, fixture.viewportHeight);
      const header = cropPixelImage(expected, 0, 0, fixture.width, stickyRows);
      const content = cropPixelImage(
        expected,
        0,
        stickyRows + scrollTop,
        fixture.width,
        viewportContentHeight,
      );
      for (let y = 0; y < stickyRows; y += 1) {
        frame.data.set(
          header.data.subarray(y * fixture.width * 4, (y + 1) * fixture.width * 4),
          y * fixture.width * 4,
        );
      }
      for (let y = 0; y < viewportContentHeight; y += 1) {
        frame.data.set(
          content.data.subarray(y * fixture.width * 4, (y + 1) * fixture.width * 4),
          (stickyRows + y) * fixture.width * 4,
        );
      }
    } else {
      frame = cropPixelImage(
        expected,
        0,
        scrollTop,
        fixture.width,
        fixture.viewportHeight,
      );
    }
    frames.push({
      image: frame,
      index,
      timestamp: 1778830000000 + index * 100,
      scrollTop,
      deviceScaleFactor: fixture.deviceScaleFactor ?? 1,
      captureRect: {
        x: 0,
        y: 0,
        width: fixture.width,
        height: fixture.viewportHeight,
      },
    });
  }

  return frames;
}

function createSeamImage(actual, seamRows) {
  const seams = createPixelImage(actual.width, actual.height);
  seams.data.set(actual.data);
  for (const y of seamRows) {
    paintRect(seams, 0, Math.max(0, y - 1), seams.width, 3, {
      r: 255,
      g: 0,
      b: 0,
      a: 255,
    });
  }
  return seams;
}

function decodeMarkerAt(image, y) {
  const offset = pixelOffset(image, 0, y);
  return (
    image.data[offset] |
    (image.data[offset + 1] << 8) |
    (image.data[offset + 2] << 16)
  );
}

function evaluateStripedMarkers(actual, expected) {
  const stripeHeight = 16;
  const expectedMarkers = [];
  const actualMarkers = [];
  for (let y = 0; y < expected.height; y += stripeHeight) {
    expectedMarkers.push(decodeMarkerAt(expected, y));
  }
  for (let y = 0; y < actual.height; y += stripeHeight) {
    actualMarkers.push(decodeMarkerAt(actual, y));
  }

  const expectedCounts = new Map();
  const actualCounts = new Map();
  for (const marker of expectedMarkers) {
    expectedCounts.set(marker, (expectedCounts.get(marker) ?? 0) + 1);
  }
  for (const marker of actualMarkers) {
    actualCounts.set(marker, (actualCounts.get(marker) ?? 0) + 1);
  }

  let missingRows = 0;
  let duplicatedRows = 0;
  for (const [marker, expectedCount] of expectedCounts) {
    const actualCount = actualCounts.get(marker) ?? 0;
    if (actualCount < expectedCount) {
      missingRows += (expectedCount - actualCount) * stripeHeight;
    }
    if (actualCount > expectedCount) {
      duplicatedRows += (actualCount - expectedCount) * stripeHeight;
    }
  }
  for (const [marker, actualCount] of actualCounts) {
    if (!expectedCounts.has(marker)) {
      duplicatedRows += actualCount * stripeHeight;
    }
  }

  let inOrder = 0;
  const compared = Math.min(expectedMarkers.length, actualMarkers.length);
  for (let index = 0; index < compared; index += 1) {
    if (expectedMarkers[index] === actualMarkers[index]) {
      inOrder += 1;
    }
  }

  return {
    missingRows,
    duplicatedRows,
    markerCoverage: expectedMarkers.length === 0 ? 0 : inOrder / expectedMarkers.length,
  };
}

const fixtureDefinitions = [
  { name: "basic-long-page", width: frameWidth, height: 2920, viewportHeight: frameViewportHeight, scrollStep: 420 },
  { name: "striped-markers", width: frameWidth, height: 3200, viewportHeight: frameViewportHeight, scrollStep: 416 },
  { name: "sticky-header", width: frameWidth, height: 2440, viewportHeight: frameViewportHeight, scrollStep: 420, stickyHeaderRows: 40 },
  { name: "lazy-images", width: frameWidth, height: 2780, viewportHeight: frameViewportHeight, scrollStep: 400 },
  { name: "nested-scroll", width: frameWidth, height: 3020, viewportHeight: frameViewportHeight, scrollStep: 390 },
  { name: "virtualized-list", width: frameWidth, height: 2860, viewportHeight: frameViewportHeight, scrollStep: 440 },
  { name: "chat-history-like", width: frameWidth, height: 2740, viewportHeight: frameViewportHeight, scrollStep: 410 },
  { name: "pdf-like", width: frameWidth, height: 3240, viewportHeight: frameViewportHeight, scrollStep: 430 },
  { name: "high-dpi-scale", width: frameWidth * 2, height: 2980, viewportHeight: frameViewportHeight, scrollStep: 420, deviceScaleFactor: 2 },
];

async function evaluateFixture(fixture) {
  const fixtureDir = join(fixturesDir, fixture.name);
  const framesDir = join(fixtureDir, "frames");
  await mkdir(framesDir, { recursive: true });

  const expected = createExpected(fixture.name, fixture);
  const frames = createFrames(expected, fixture);
  const stitched = stitchFrames(frames, {
    stickyHeaderRows: fixture.stickyHeaderRows ? "auto" : 0,
    minOverlapRatio: 0.12,
    maxOverlapRatio: 0.92,
    minScrollDelta: 4,
    minConfidence: 0.96,
    strategy: "sampled",
    sampleColumns: 80,
    sampleRows: 220,
  });
  const actual = stitched.image;
  const diff = createDiffImage(actual, expected);
  const seams = createSeamImage(actual, stitched.plan.seamRows);
  const diffStats = compareImages(actual, expected);
  const markerStats = fixture.name === "striped-markers"
    ? evaluateStripedMarkers(actual, expected)
    : { missingRows: 0, duplicatedRows: 0, markerCoverage: 1 };
  const lowConfidenceMatches = stitched.plan.frames.filter(
    (frame) => frame.confidence < 0.96,
  );
  const badSeams = lowConfidenceMatches.length;
  const criticalFailures = [
    diffStats.sizeMismatch,
    markerStats.missingRows > 0,
    markerStats.duplicatedRows > 0,
    badSeams > 0,
    stitched.plan.warnings.length > 0,
  ].filter(Boolean).length;

  await writePng(join(fixtureDir, "expected.png"), expected);
  await writePng(join(fixtureDir, "actual.png"), actual);
  await writePng(join(fixtureDir, "diff.png"), diff);
  await writePng(join(fixtureDir, "seams.png"), seams);
  await writeFile(
    join(fixtureDir, "stitch-plan.json"),
    JSON.stringify(stitched.plan, null, 2),
  );
  await writeFile(
    join(fixtureDir, "log.json"),
    JSON.stringify(
      {
        fixture,
        frames: frames.map((frame) => ({
          index: frame.index,
          scrollTop: frame.scrollTop,
          width: frame.image.width,
          height: frame.image.height,
          deviceScaleFactor: frame.deviceScaleFactor,
          captureRect: frame.captureRect,
        })),
        warnings: stitched.plan.warnings,
        failureReason: stitched.plan.failureReason,
      },
      null,
      2,
    ),
  );

  for (const frame of frames) {
    await writePng(
      join(framesDir, `frame-${String(frame.index).padStart(3, "0")}.png`),
      frame.image,
    );
  }

  return {
    name: fixture.name,
    passed:
      diffStats.score >= qualityGate.overallScore &&
      criticalFailures === 0 &&
      markerStats.missingRows === 0 &&
      markerStats.duplicatedRows === 0 &&
      badSeams === 0 &&
      markerStats.markerCoverage >= qualityGate.markerCoverage,
    score: diffStats.score,
    criticalFailures,
    missingRows: markerStats.missingRows,
    duplicatedRows: markerStats.duplicatedRows,
    badSeams,
    markerCoverage: markerStats.markerCoverage,
    noPrematureCutoff: actual.height === expected.height,
    noScaleMismatch: !diffStats.sizeMismatch,
    frameCount: frames.length,
    actual: { width: actual.width, height: actual.height },
    expected: { width: expected.width, height: expected.height },
    diff: diffStats,
    plan: stitched.plan,
    artifacts: {
      actual: `fixtures/${fixture.name}/actual.png`,
      expected: `fixtures/${fixture.name}/expected.png`,
      diff: `fixtures/${fixture.name}/diff.png`,
      seams: `fixtures/${fixture.name}/seams.png`,
      stitchPlan: `fixtures/${fixture.name}/stitch-plan.json`,
      frames: `fixtures/${fixture.name}/frames/`,
      logs: `fixtures/${fixture.name}/log.json`,
    },
  };
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(fixturesDir, { recursive: true });

  const fixtures = [];
  for (const fixture of fixtureDefinitions) {
    fixtures.push(await evaluateFixture(fixture));
  }

  const overallScore =
    fixtures.reduce((sum, fixture) => sum + fixture.score, 0) / fixtures.length;
  const criticalFailures = fixtures.reduce(
    (sum, fixture) => sum + fixture.criticalFailures,
    0,
  );
  const missingRows = fixtures.reduce((sum, fixture) => sum + fixture.missingRows, 0);
  const duplicatedRows = fixtures.reduce(
    (sum, fixture) => sum + fixture.duplicatedRows,
    0,
  );
  const badSeams = fixtures.reduce((sum, fixture) => sum + fixture.badSeams, 0);
  const markerCoverage = Math.min(
    ...fixtures.map((fixture) => fixture.markerCoverage),
  );
  const qualityGatePassed =
    overallScore >= qualityGate.overallScore &&
    criticalFailures === 0 &&
    missingRows === 0 &&
    duplicatedRows === 0 &&
    badSeams === 0 &&
    markerCoverage >= qualityGate.markerCoverage &&
    fixtures.every((fixture) => fixture.noPrematureCutoff && fixture.noScaleMismatch);

  const canonical = fixtures.find((fixture) => fixture.name === "striped-markers") ?? fixtures[0];
  if (canonical) {
    await writeFile(
      join(outDir, "actual.png"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(fixturesDir, canonical.name, "actual.png")),
      ),
    );
    await writeFile(
      join(outDir, "expected.png"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(fixturesDir, canonical.name, "expected.png")),
      ),
    );
    await writeFile(
      join(outDir, "diff.png"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(fixturesDir, canonical.name, "diff.png")),
      ),
    );
    await writeFile(
      join(outDir, "seams.png"),
      await import("node:fs/promises").then(({ readFile }) =>
        readFile(join(fixturesDir, canonical.name, "seams.png")),
      ),
    );
    await writeFile(
      join(outDir, "stitch-plan.json"),
      JSON.stringify(canonical.plan, null, 2),
    );
  }

  const results = {
    generatedAt: new Date().toISOString(),
    qualityGate,
    qualityGatePassed,
    overallScore,
    criticalFailures,
    missingRows,
    duplicatedRows,
    badSeams,
    markerCoverage,
    fixtures,
    failureCategories: {
      missingContent: missingRows > 0,
      duplicatedContent: duplicatedRows > 0,
      badOverlapOffset: fixtures.some((fixture) =>
        fixture.plan.frames.some((frame) => frame.deltaY <= 0 && frame.inputIndex > 0),
      ),
      badSeam: badSeams > 0,
      stickyHeaderDuplication: fixtures.some(
        (fixture) => fixture.name === "sticky-header" && fixture.diff.differentPixels > 0,
      ),
      insufficientOverlap: fixtures.some((fixture) =>
        fixture.plan.warnings.some((warning) => warning.includes("insufficient overlap")),
      ),
      manualScrollTooFast: false,
      dynamicContentInstability: false,
      captureFailure: false,
      platformLimitation: false,
      dpiScaleMismatch: fixtures.some((fixture) => !fixture.noScaleMismatch),
      prematureBottomDetection: fixtures.some((fixture) => !fixture.noPrematureCutoff),
    },
  };

  await writeFile(join(outDir, "eval-results.json"), JSON.stringify(results, null, 2));

  const rows = fixtures
    .map(
      (fixture) =>
        `| ${fixture.name} | ${fixture.passed ? "pass" : "fail"} | ${fixture.score.toFixed(6)} | ${fixture.frameCount} | ${fixture.actual.width}x${fixture.actual.height} | ${fixture.criticalFailures} | ${fixture.plan.warnings.join("; ") || "-"} |`,
    )
    .join("\n");
  const summary = `# Scrollshot Evaluation

Quality gate: ${qualityGatePassed ? "PASS" : "FAIL"}

| Metric | Value | Gate |
| --- | ---: | ---: |
| overallScore | ${overallScore.toFixed(6)} | >= ${qualityGate.overallScore} |
| criticalFailures | ${criticalFailures} | ${qualityGate.criticalFailures} |
| missingRows | ${missingRows} | ${qualityGate.missingRows} |
| duplicatedRows | ${duplicatedRows} | ${qualityGate.duplicatedRows} |
| badSeams | ${badSeams} | ${qualityGate.badSeams} |
| markerCoverage | ${markerCoverage.toFixed(6)} | >= ${qualityGate.markerCoverage} |

| Fixture | Result | Score | Frames | Actual Size | Critical Failures | Warnings |
| --- | --- | ---: | ---: | --- | ---: | --- |
${rows}

Artifacts:
- Root comparison images mirror the striped marker fixture: actual.png, expected.png, diff.png, seams.png.
- Per-fixture artifacts are under artifacts/latest/fixtures/<fixture>/.
- stitch-plan.json includes frame count, capture rectangle, frame dimensions, device scale factor, offsets, overlap confidence, seam rows, duplicate frames, warnings, final height, and failure reason.
`;
  await writeFile(join(outDir, "summary.md"), summary);

  if (!qualityGatePassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
