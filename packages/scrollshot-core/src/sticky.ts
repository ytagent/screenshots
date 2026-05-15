import type { PixelImage, ScrollshotFrame } from "./types";

function sampledRowDifference(a: PixelImage, b: PixelImage, y: number): number {
  const sampleCount = Math.min(64, a.width);
  const denominator = sampleCount * 3 * 255;
  let error = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const x =
      sampleCount === 1
        ? Math.floor(a.width / 2)
        : Math.round((sample * (a.width - 1)) / (sampleCount - 1));
    const aOffset = (y * a.width + x) * 4;
    const bOffset = (y * b.width + x) * 4;
    error += Math.abs((a.data[aOffset] ?? 0) - (b.data[bOffset] ?? 0));
    error += Math.abs(
      (a.data[aOffset + 1] ?? 0) - (b.data[bOffset + 1] ?? 0),
    );
    error += Math.abs(
      (a.data[aOffset + 2] ?? 0) - (b.data[bOffset + 2] ?? 0),
    );
  }

  return denominator === 0 ? 1 : error / denominator;
}

export function detectStickyHeaderRows(
  frames: ScrollshotFrame[],
  maxRows?: number,
): number {
  if (frames.length < 2) {
    return 0;
  }

  const first = frames[0]?.image;
  if (!first) {
    return 0;
  }
  const limit = Math.min(
    maxRows ?? Math.floor(first.height * 0.28),
    first.height - 1,
  );
  let stickyRows = 0;

  for (let y = 0; y < limit; y += 1) {
    let rowStable = true;
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1]?.image;
      const next = frames[index]?.image;
      if (!previous || !next) {
        continue;
      }
      if (
        previous.width !== next.width ||
        previous.height !== next.height ||
        sampledRowDifference(previous, next, y) > 0.006
      ) {
        rowStable = false;
        break;
      }
    }

    if (!rowStable) {
      break;
    }
    stickyRows = y + 1;
  }

  return stickyRows >= 12 ? stickyRows : 0;
}
