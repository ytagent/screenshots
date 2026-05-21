import {
  assertImageShape,
  copyRows,
  createPixelImage,
  sampledImageDifference,
} from "./image";
import { estimateVerticalOverlap } from "./overlap";
import { detectStickyHeaderRows } from "./sticky";
import type {
  ScrollshotFrame,
  StitchOptions,
  StitchPlan,
  StitchPlanFrame,
  StitchResult,
} from "./types";

function validateFrames(frames: ScrollshotFrame[]): void {
  if (frames.length === 0) {
    throw new Error("Cannot stitch zero frames");
  }

  const first = frames[0];
  if (!first) {
    throw new Error("Cannot stitch empty frame list");
  }
  assertImageShape(first.image, "frame[0]");

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame) {
      throw new Error(`Missing frame at index ${index}`);
    }
    assertImageShape(frame.image, `frame[${index}]`);
    if (
      frame.image.width !== first.image.width ||
      frame.image.height !== first.image.height
    ) {
      throw new Error(
        `Frame ${index} shape ${frame.image.width}x${frame.image.height} does not match first frame ${first.image.width}x${first.image.height}`,
      );
    }
    if (
      first.deviceScaleFactor !== undefined &&
      frame.deviceScaleFactor !== undefined &&
      Math.abs(first.deviceScaleFactor - frame.deviceScaleFactor) > 0.001
    ) {
      throw new Error(
        `Frame ${index} deviceScaleFactor ${frame.deviceScaleFactor} does not match first frame ${first.deviceScaleFactor}`,
      );
    }
  }
}

function normalizedSameFrameScore(
  previous: ScrollshotFrame,
  next: ScrollshotFrame,
  options: StitchOptions,
  ignoreTopRows: number,
): number {
  const width = previous.image.width;
  return sampledImageDifference(previous.image, next.image, {
    sampleColumns: options.sampleColumns ?? 48,
    sampleRows: options.sampleRows ?? 180,
    ignoreLeftColumns: options.ignoreLeftColumns ?? 2,
    ignoreRightColumns:
      options.ignoreRightColumns ?? Math.min(28, Math.max(8, width * 0.06)),
    ignoreTopRows,
  });
}

// 正向 score 低于此阈值时认为匹配已经足够干净，跳过反向匹配以省 CPU。
const CLEAN_FORWARD_SCORE = 0.01;
// 反向 score 比正向 score 低于这个比例时判定为反向滚动 / 无重叠伪匹配。
const REVERSE_BETTER_RATIO = 0.85;

export function stitchFrames(
  frames: ScrollshotFrame[],
  options: StitchOptions = {},
): StitchResult {
  validateFrames(frames);

  const firstFrame = frames[0];
  if (!firstFrame) {
    throw new Error("Cannot stitch empty frame list");
  }

  const stickyHeaderRows =
    options.stickyHeaderRows === "auto" || options.stickyHeaderRows === undefined
      ? detectStickyHeaderRows(frames)
      : Math.max(0, Math.floor(options.stickyHeaderRows));
  const duplicateDeltaThreshold = options.duplicateDeltaThreshold ?? 2;
  const duplicateConfidenceThreshold =
    options.duplicateConfidenceThreshold ?? 0.985;
  const duplicateFrameScoreThreshold =
    options.duplicateFrameScoreThreshold ?? 0.002;
  const transientFrameDeltaThreshold = Math.max(
    0,
    options.transientFrameDeltaThreshold ?? 0,
  );
  const minConfidence = options.minConfidence ?? 0.92;

  const planFrames: StitchPlanFrame[] = [
    {
      inputIndex: 0,
      outputY: 0,
      sourceY: 0,
      rows: firstFrame.image.height,
      deltaY: 0,
      overlapRows: firstFrame.image.height - stickyHeaderRows,
      confidence: 1,
      warnings: [],
    },
  ];
  const warnings: string[] = [];
  const discardedDuplicateFrames: number[] = [];
  const discardedTransientFrames: number[] = [];
  const estimatedOffsets: number[] = [0];
  const seamRows: number[] = [];
  let outputHeight = firstFrame.image.height;
  let lastAccepted = firstFrame;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame) {
      continue;
    }

    const sameFrameScore = normalizedSameFrameScore(
      lastAccepted,
      frame,
      options,
      stickyHeaderRows,
    );
    if (sameFrameScore <= duplicateFrameScoreThreshold) {
      discardedDuplicateFrames.push(index);
      planFrames.push({
        inputIndex: index,
        outputY: outputHeight,
        sourceY: 0,
        rows: 0,
        deltaY: 0,
        overlapRows: frame.image.height - stickyHeaderRows,
        confidence: 1,
        discardedDuplicate: true,
        warnings: ["duplicate frame discarded"],
      });
      continue;
    }

    const match = estimateVerticalOverlap(lastAccepted.image, frame.image, {
      ...options,
      ignoreTopRows: stickyHeaderRows,
    });
    // 反向匹配让 stitch 的 CPU 翻倍。仅在正向匹配不够干净时才跑，
    // 避免典型干净滚动场景下渲染进程卡死。
    const reverseMatch =
      match.score < CLEAN_FORWARD_SCORE
        ? null
        : estimateVerticalOverlap(frame.image, lastAccepted.image, {
            ...options,
            ignoreTopRows: stickyHeaderRows,
          });
    const frameWarnings: string[] = [];
    const isDuplicate =
      match.deltaY <= duplicateDeltaThreshold &&
      match.confidence >= duplicateConfidenceThreshold;

    if (isDuplicate) {
      discardedDuplicateFrames.push(index);
      planFrames.push({
        inputIndex: index,
        outputY: outputHeight,
        sourceY: 0,
        rows: 0,
        deltaY: match.deltaY,
        overlapRows: match.overlapRows,
        confidence: match.confidence,
        score: match.score,
        reverseScore: reverseMatch?.score,
        discardedDuplicate: true,
        warnings: ["duplicate frame discarded"],
      });
      continue;
    }

    // 任何 deltaY 大于"近似重复"阈值但置信度低的匹配都是不可信的，
    // 直接保留只会把已显示的内容再粘一遍，造成视觉重复。
    const isTransient =
      transientFrameDeltaThreshold > 0 &&
      match.deltaY > duplicateDeltaThreshold &&
      match.confidence < minConfidence;
    // 反向更优 = 用户向上滚 / 帧间无真实重叠。reverseMatch 为 null 时
    // 表示正向已经很干净，自然不会走这一支。
    const isReverseScroll =
      reverseMatch !== null &&
      match.deltaY > duplicateDeltaThreshold &&
      reverseMatch.score < match.score * REVERSE_BETTER_RATIO;

    if (isTransient || isReverseScroll) {
      discardedTransientFrames.push(index);
      planFrames.push({
        inputIndex: index,
        outputY: outputHeight,
        sourceY: 0,
        rows: 0,
        deltaY: match.deltaY,
        overlapRows: match.overlapRows,
        confidence: match.confidence,
        score: match.score,
        reverseScore: reverseMatch?.score,
        discardedTransient: true,
        warnings: [
          isReverseScroll
            ? "reverse-scroll or no-overlap frame discarded"
            : "transient low-confidence frame discarded",
        ],
      });
      continue;
    }

    if (match.confidence < minConfidence) {
      frameWarnings.push(
        `low overlap confidence ${match.confidence.toFixed(4)} for frame ${index}`,
      );
    }
    if (match.overlapRows < Math.max(12, firstFrame.image.height * 0.05)) {
      frameWarnings.push(
        `insufficient overlap ${match.overlapRows}px for frame ${index}`,
      );
    }
    if (match.deltaY <= 0) {
      frameWarnings.push(`non-positive scroll delta ${match.deltaY} for frame ${index}`);
    }
    if (match.deltaY > firstFrame.image.height - stickyHeaderRows) {
      frameWarnings.push(
        `scroll delta ${match.deltaY}px is larger than searchable content height`,
      );
    }

    warnings.push(...frameWarnings);
    seamRows.push(outputHeight);
    estimatedOffsets.push(
      (estimatedOffsets[estimatedOffsets.length - 1] ?? 0) + match.deltaY,
    );
    planFrames.push({
      inputIndex: index,
      outputY: outputHeight,
      sourceY: Math.max(stickyHeaderRows, frame.image.height - match.deltaY),
      rows: match.deltaY,
      deltaY: match.deltaY,
      overlapRows: match.overlapRows,
      confidence: match.confidence,
      score: match.score,
      reverseScore: reverseMatch?.score,
      warnings: frameWarnings,
    });
    outputHeight += match.deltaY;
    lastAccepted = frame;
  }

  const output = createPixelImage(firstFrame.image.width, outputHeight);
  for (const framePlan of planFrames) {
    if (
      framePlan.rows <= 0 ||
      framePlan.discardedDuplicate ||
      framePlan.discardedTransient
    ) {
      continue;
    }
    const sourceFrame = frames[framePlan.inputIndex];
    if (!sourceFrame) {
      continue;
    }
    copyRows(
      sourceFrame.image,
      framePlan.sourceY,
      output,
      framePlan.outputY,
      framePlan.rows,
    );
  }

  const plan: StitchPlan = {
    frameCount: frames.length,
    acceptedFrameCount:
      frames.length -
      discardedDuplicateFrames.length -
      discardedTransientFrames.length,
    discardedDuplicateFrames,
    discardedTransientFrames,
    width: output.width,
    height: output.height,
    stickyHeaderRows,
    estimatedOffsets,
    seamRows,
    frames: planFrames,
    warnings,
  };

  if (firstFrame.deviceScaleFactor !== undefined) {
    plan.deviceScaleFactor = firstFrame.deviceScaleFactor;
  }

  // 只把"实质性失败"标为 failure。warnings 只是个别帧的瑕疵提示，
  // 不该让整次拼接作废。这里的失败定义是：除了第一帧，没有任何后续帧
  // 被接受 → 整段没有有效滚动内容，输出图等于第一帧。
  if (plan.acceptedFrameCount <= 1) {
    plan.failureReason = "no scrollable content captured";
  }

  return { image: output, plan };
}
