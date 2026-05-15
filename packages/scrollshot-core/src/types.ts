export interface PixelImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollshotFrame {
  image: PixelImage;
  index?: number;
  timestamp?: number;
  scrollTop?: number;
  deviceScaleFactor?: number;
  captureRect?: CaptureRect;
}

export type OverlapStrategy = "sampled" | "exhaustive";

export interface OverlapOptions {
  strategy?: OverlapStrategy;
  minOverlapRatio?: number;
  maxOverlapRatio?: number;
  minScrollDelta?: number;
  maxScrollDelta?: number;
  ignoreTopRows?: number;
  ignoreLeftColumns?: number;
  ignoreRightColumns?: number;
  sampleColumns?: number;
  sampleRows?: number;
}

export interface OverlapMatch {
  deltaY: number;
  overlapRows: number;
  confidence: number;
  score: number;
  secondBestScore: number;
  strategy: OverlapStrategy;
}

export interface StitchOptions extends OverlapOptions {
  stickyHeaderRows?: number | "auto";
  duplicateDeltaThreshold?: number;
  duplicateConfidenceThreshold?: number;
  duplicateFrameScoreThreshold?: number;
  minConfidence?: number;
}

export interface StitchPlanFrame {
  inputIndex: number;
  outputY: number;
  sourceY: number;
  rows: number;
  deltaY: number;
  overlapRows: number;
  confidence: number;
  discardedDuplicate?: boolean;
  warnings: string[];
}

export interface StitchPlan {
  frameCount: number;
  acceptedFrameCount: number;
  discardedDuplicateFrames: number[];
  width: number;
  height: number;
  deviceScaleFactor?: number;
  stickyHeaderRows: number;
  estimatedOffsets: number[];
  seamRows: number[];
  frames: StitchPlanFrame[];
  warnings: string[];
  failureReason?: string;
}

export interface StitchResult {
  image: PixelImage;
  plan: StitchPlan;
}

export interface ImageDiffStats {
  width: number;
  height: number;
  comparedPixels: number;
  averageChannelError: number;
  maxChannelError: number;
  differentPixels: number;
  score: number;
  sizeMismatch: boolean;
}
