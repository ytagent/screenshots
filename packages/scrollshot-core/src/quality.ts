import { createPixelImage, pixelOffset } from "./image";
import type { ImageDiffStats, PixelImage } from "./types";

export function compareImages(
  actual: PixelImage,
  expected: PixelImage,
): ImageDiffStats {
  const width = Math.min(actual.width, expected.width);
  const height = Math.min(actual.height, expected.height);
  let totalError = 0;
  let maxChannelError = 0;
  let differentPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const actualOffset = pixelOffset(actual, x, y);
      const expectedOffset = pixelOffset(expected, x, y);
      let pixelError = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const error = Math.abs(
          (actual.data[actualOffset + channel] ?? 0) -
            (expected.data[expectedOffset + channel] ?? 0),
        );
        totalError += error;
        pixelError += error;
        maxChannelError = Math.max(maxChannelError, error);
      }
      if (pixelError > 0) {
        differentPixels += 1;
      }
    }
  }

  const comparedPixels = width * height;
  const comparedChannels = comparedPixels * 3;
  const sizeMismatch =
    actual.width !== expected.width || actual.height !== expected.height;
  const averageChannelError =
    comparedChannels === 0 ? 255 : totalError / comparedChannels;
  const baseScore = 1 - averageChannelError / 255;
  const sizePenalty = sizeMismatch ? 0.15 : 0;

  return {
    width,
    height,
    comparedPixels,
    averageChannelError,
    maxChannelError,
    differentPixels,
    score: Math.max(0, baseScore - sizePenalty),
    sizeMismatch,
  };
}

export function createDiffImage(
  actual: PixelImage,
  expected: PixelImage,
): PixelImage {
  const width = Math.max(actual.width, expected.width);
  const height = Math.max(actual.height, expected.height);
  const diff = createPixelImage(width, height, { r: 255, g: 255, b: 255, a: 255 });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const outputOffset = pixelOffset(diff, x, y);
      if (x >= actual.width || y >= actual.height) {
        diff.data[outputOffset] = 255;
        diff.data[outputOffset + 1] = 0;
        diff.data[outputOffset + 2] = 0;
        continue;
      }
      if (x >= expected.width || y >= expected.height) {
        diff.data[outputOffset] = 0;
        diff.data[outputOffset + 1] = 0;
        diff.data[outputOffset + 2] = 255;
        continue;
      }

      const actualOffset = pixelOffset(actual, x, y);
      const expectedOffset = pixelOffset(expected, x, y);
      const error =
        Math.abs(
          (actual.data[actualOffset] ?? 0) -
            (expected.data[expectedOffset] ?? 0),
        ) +
        Math.abs(
          (actual.data[actualOffset + 1] ?? 0) -
            (expected.data[expectedOffset + 1] ?? 0),
        ) +
        Math.abs(
          (actual.data[actualOffset + 2] ?? 0) -
            (expected.data[expectedOffset + 2] ?? 0),
        );
      const amplified = Math.min(255, error * 4);
      diff.data[outputOffset] = 255;
      diff.data[outputOffset + 1] = 255 - amplified;
      diff.data[outputOffset + 2] = 255 - amplified;
    }
  }

  return diff;
}
