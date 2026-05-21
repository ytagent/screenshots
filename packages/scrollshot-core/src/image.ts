import type { PixelImage } from "./types";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export function createPixelImage(
  width: number,
  height: number,
  fill: Rgba = { r: 255, g: 255, b: 255, a: 255 },
): PixelImage {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`Image dimensions must be integers. Got ${width}x${height}`);
  }
  if (width <= 0 || height <= 0) {
    throw new Error(`Image dimensions must be positive. Got ${width}x${height}`);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = fill.r;
    data[offset + 1] = fill.g;
    data[offset + 2] = fill.b;
    data[offset + 3] = fill.a ?? 255;
  }
  return { width, height, data };
}

export function clonePixelImage(image: PixelImage): PixelImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

export function assertImageShape(image: PixelImage, label = "image"): void {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new Error(`${label} dimensions must be integers`);
  }
  const expectedLength = image.width * image.height * 4;
  if (image.data.length !== expectedLength) {
    throw new Error(
      `${label} data length ${image.data.length} does not match ${expectedLength}`,
    );
  }
}

export function pixelOffset(image: PixelImage, x: number, y: number): number {
  return (y * image.width + x) * 4;
}

export function copyRows(
  source: PixelImage,
  sourceY: number,
  target: PixelImage,
  targetY: number,
  rows: number,
): void {
  if (rows <= 0) {
    return;
  }
  if (
    sourceY < 0 ||
    targetY < 0 ||
    sourceY + rows > source.height ||
    targetY + rows > target.height
  ) {
    throw new Error(
      `copyRows out of bounds sourceY=${sourceY} targetY=${targetY} rows=${rows}`,
    );
  }
  if (source.width !== target.width) {
    throw new Error("copyRows requires equal widths");
  }

  const rowBytes = source.width * 4;
  for (let row = 0; row < rows; row += 1) {
    const sourceStart = (sourceY + row) * rowBytes;
    const targetStart = (targetY + row) * rowBytes;
    target.data.set(
      source.data.subarray(sourceStart, sourceStart + rowBytes),
      targetStart,
    );
  }
}

export function cropPixelImage(
  source: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
): PixelImage {
  if (x < 0 || y < 0 || x + width > source.width || y + height > source.height) {
    throw new Error(
      `crop out of bounds x=${x} y=${y} width=${width} height=${height}`,
    );
  }

  const target = createPixelImage(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * source.width + x) * 4;
    const targetStart = row * width * 4;
    target.data.set(
      source.data.subarray(sourceStart, sourceStart + width * 4),
      targetStart,
    );
  }
  return target;
}

export function paintRect(
  image: PixelImage,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba,
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(image.width, Math.ceil(x + width));
  const y1 = Math.min(image.height, Math.ceil(y + height));

  for (let row = y0; row < y1; row += 1) {
    for (let col = x0; col < x1; col += 1) {
      const offset = pixelOffset(image, col, row);
      image.data[offset] = color.r;
      image.data[offset + 1] = color.g;
      image.data[offset + 2] = color.b;
      image.data[offset + 3] = color.a ?? 255;
    }
  }
}

export interface SampledDifferenceOptions {
  sampleColumns?: number;
  sampleRows?: number;
  ignoreLeftColumns?: number;
  ignoreRightColumns?: number;
  ignoreTopRows?: number;
}

export function sampledImageDifference(
  a: PixelImage,
  b: PixelImage,
  options: SampledDifferenceOptions = {},
): number {
  if (a.width !== b.width || a.height !== b.height) {
    return 1;
  }
  const sampleColumns = options.sampleColumns ?? 32;
  const sampleRows = options.sampleRows ?? 64;
  const ignoreLeft = Math.max(0, Math.floor(options.ignoreLeftColumns ?? 0));
  const ignoreRight = Math.max(0, Math.floor(options.ignoreRightColumns ?? 0));
  const ignoreTop = Math.max(0, Math.floor(options.ignoreTopRows ?? 0));
  const usableWidth = Math.max(1, a.width - ignoreLeft - ignoreRight);
  const usableHeight = Math.max(1, a.height - ignoreTop);
  const colStep = Math.max(1, Math.floor(usableWidth / sampleColumns));
  const rowStep = Math.max(1, Math.floor(usableHeight / sampleRows));
  let total = 0;
  let count = 0;
  for (let y = ignoreTop; y < a.height; y += rowStep) {
    for (let x = ignoreLeft; x < a.width - ignoreRight; x += colStep) {
      const offset = (y * a.width + x) * 4;
      total += Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0));
      total += Math.abs((a.data[offset + 1] ?? 0) - (b.data[offset + 1] ?? 0));
      total += Math.abs((a.data[offset + 2] ?? 0) - (b.data[offset + 2] ?? 0));
      count += 1;
    }
  }
  return count === 0 ? 1 : total / (count * 3 * 255);
}
