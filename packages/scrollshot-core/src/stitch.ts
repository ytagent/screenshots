import { assertImageShape, copyRows, createPixelImage } from "./image";
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
  const estimatedOffsets: number[] = [0];
  const seamRows: number[] = [];
  let outputHeight = firstFrame.image.height;
  let lastAccepted = firstFrame;

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (!frame) {
      continue;
    }

    const match = estimateVerticalOverlap(lastAccepted.image, frame.image, {
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
        discardedDuplicate: true,
        warnings: ["duplicate frame discarded"],
      });
      continue;
    }

    if (match.confidence < minConfidence) {
      frameWarnings.push(
        `low overlap confidence ${match.confidence.toFixed(4)} for frame ${index}`,
      );
    }
    if (match.overlapRows < Math.max(12, firstFrame.image.height * 0.12)) {
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
      warnings: frameWarnings,
    });
    outputHeight += match.deltaY;
    lastAccepted = frame;
  }

  const output = createPixelImage(firstFrame.image.width, outputHeight);
  for (const framePlan of planFrames) {
    if (framePlan.rows <= 0 || framePlan.discardedDuplicate) {
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
    acceptedFrameCount: frames.length - discardedDuplicateFrames.length,
    discardedDuplicateFrames,
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

  if (warnings.length > 0) {
    plan.failureReason = warnings.join("; ");
  }

  return { image: output, plan };
}
