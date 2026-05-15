import type {
  OverlapMatch,
  OverlapOptions,
  OverlapStrategy,
  PixelImage,
} from "./types";

function buildSamples(length: number, requested: number): number[] {
  const count = Math.max(1, Math.min(length, Math.floor(requested)));
  if (count === length) {
    return Array.from({ length }, (_, index) => index);
  }
  if (count === 1) {
    return [Math.floor(length / 2)];
  }
  return Array.from({ length: count }, (_, index) =>
    Math.min(length - 1, Math.round((index * (length - 1)) / (count - 1))),
  );
}

function channelError(
  previous: PixelImage,
  next: PixelImage,
  previousY: number,
  nextY: number,
  columns: number[],
): number {
  let error = 0;
  for (const x of columns) {
    const previousOffset = (previousY * previous.width + x) * 4;
    const nextOffset = (nextY * next.width + x) * 4;
    error += Math.abs(
      (previous.data[previousOffset] ?? 0) - (next.data[nextOffset] ?? 0),
    );
    error += Math.abs(
      (previous.data[previousOffset + 1] ?? 0) -
        (next.data[nextOffset + 1] ?? 0),
    );
    error += Math.abs(
      (previous.data[previousOffset + 2] ?? 0) -
        (next.data[nextOffset + 2] ?? 0),
    );
  }
  return error;
}

function scoreDelta(
  previous: PixelImage,
  next: PixelImage,
  deltaY: number,
  ignoreTopRows: number,
  sampleColumns: number,
  sampleRows: number,
): { score: number; overlapRows: number } {
  const overlapRows = previous.height - ignoreTopRows - deltaY;
  if (overlapRows <= 0) {
    return { score: Number.POSITIVE_INFINITY, overlapRows: 0 };
  }

  const columns = buildSamples(previous.width, sampleColumns);
  const rowSamples = buildSamples(overlapRows, sampleRows);
  let error = 0;

  for (const sample of rowSamples) {
    error += channelError(
      previous,
      next,
      ignoreTopRows + deltaY + sample,
      ignoreTopRows + sample,
      columns,
    );
  }

  const denominator = rowSamples.length * columns.length * 3 * 255;
  return {
    score: denominator === 0 ? Number.POSITIVE_INFINITY : error / denominator,
    overlapRows,
  };
}

function candidateDeltas(
  previous: PixelImage,
  options: {
    minOverlapRatio: number;
    maxOverlapRatio: number;
    minScrollDelta: number;
    ignoreTopRows: number;
    maxScrollDelta?: number | undefined;
    strategy?: OverlapStrategy | undefined;
  },
): number[] {
  const searchableHeight = previous.height - options.ignoreTopRows;
  const minOverlapRows = Math.max(
    1,
    Math.floor(searchableHeight * options.minOverlapRatio),
  );
  const maxOverlapRows = Math.max(
    minOverlapRows,
    Math.floor(searchableHeight * options.maxOverlapRatio),
  );
  const minDelta = Math.max(0, options.minScrollDelta);
  const maxDeltaFromOverlap = Math.max(0, searchableHeight - minOverlapRows);
  const minDeltaFromOverlap = Math.max(0, searchableHeight - maxOverlapRows);
  const maxDelta = Math.min(
    options.maxScrollDelta ?? maxDeltaFromOverlap,
    maxDeltaFromOverlap,
  );

  const start = Math.max(minDelta, minDeltaFromOverlap);
  const end = Math.max(start, maxDelta);
  if (options.strategy === "exhaustive" || end - start < 96) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  const coarseStep = Math.max(2, Math.floor((end - start) / 80));
  const coarse: number[] = [];
  for (let delta = start; delta <= end; delta += coarseStep) {
    coarse.push(delta);
  }
  if (coarse[coarse.length - 1] !== end) {
    coarse.push(end);
  }
  return coarse;
}

export function estimateVerticalOverlap(
  previous: PixelImage,
  next: PixelImage,
  options: OverlapOptions = {},
): OverlapMatch {
  if (previous.width !== next.width || previous.height !== next.height) {
    throw new Error(
      `Cannot match frames with different shapes: ${previous.width}x${previous.height} and ${next.width}x${next.height}`,
    );
  }

  const strategy: OverlapStrategy = options.strategy ?? "sampled";
  const normalizedOptions = {
    minOverlapRatio: options.minOverlapRatio ?? 0.18,
    maxOverlapRatio: options.maxOverlapRatio ?? 0.98,
    minScrollDelta: options.minScrollDelta ?? 0,
    maxScrollDelta: options.maxScrollDelta,
    ignoreTopRows: Math.max(0, Math.floor(options.ignoreTopRows ?? 0)),
    strategy,
  };

  const sampleColumns = options.sampleColumns ?? 48;
  const sampleRows = options.sampleRows ?? 180;
  const deltas = candidateDeltas(previous, normalizedOptions);
  const seenDeltas = new Set<number>();
  const scoredDeltas: { deltaY: number; score: number }[] = [];

  let bestDelta = deltas[0] ?? 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondBestScore = Number.POSITIVE_INFINITY;
  let bestOverlapRows = 0;

  const evaluate = (deltaY: number) => {
    if (seenDeltas.has(deltaY)) {
      return;
    }
    seenDeltas.add(deltaY);
    const { score, overlapRows } = scoreDelta(
      previous,
      next,
      deltaY,
      normalizedOptions.ignoreTopRows,
      sampleColumns,
      sampleRows,
    );
    scoredDeltas.push({ deltaY, score });
    if (score < bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestDelta = deltaY;
      bestOverlapRows = overlapRows;
    } else if (score < secondBestScore) {
      secondBestScore = score;
    }
  };

  for (const delta of deltas) {
    evaluate(delta);
  }

  if (strategy === "sampled" && deltas.length > 0) {
    const lowerBound = deltas[0] ?? 0;
    const upperBound = deltas[deltas.length - 1] ?? lowerBound;
    const gaps = deltas
      .slice(1)
      .map((delta, index) => delta - (deltas[index] ?? delta))
      .filter((gap) => gap > 0);
    const refineRadius = Math.max(3, Math.min(32, Math.max(...gaps, 3)));
    const bestCandidates = [...scoredDeltas]
      .sort((a, b) => a.score - b.score)
      .slice(0, 8);

    for (const candidate of bestCandidates) {
      const refineStart = Math.max(lowerBound, candidate.deltaY - refineRadius);
      const refineEnd = Math.min(upperBound, candidate.deltaY + refineRadius);
      for (let delta = refineStart; delta <= refineEnd; delta += 1) {
        evaluate(delta);
      }
    }
  }

  const separation =
    secondBestScore === Number.POSITIVE_INFINITY
      ? 0
      : Math.max(0, secondBestScore - bestScore);
  const confidence = Math.max(
    0,
    Math.min(1, 1 - bestScore * 3 + Math.min(0.1, separation)),
  );

  return {
    deltaY: bestDelta,
    overlapRows: bestOverlapRows,
    confidence,
    score: bestScore,
    secondBestScore,
    strategy,
  };
}
