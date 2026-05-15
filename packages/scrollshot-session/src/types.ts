import type {
  CaptureRect,
  PixelImage,
  StitchOptions,
  StitchPlan,
} from "scrollshot-core";

export interface ScrollshotProgress {
  state:
    | "idle"
    | "capturing"
    | "scrolling"
    | "stitching"
    | "finished"
    | "failed"
    | "cancelled";
  frameCount: number;
  message?: string;
  warnings: string[];
}

export interface CapturedFrame {
  image: PixelImage;
  timestamp: number;
  scrollTop?: number;
  deviceScaleFactor?: number;
  captureRect?: CaptureRect;
}

export interface FrameCaptureAdapter {
  captureFrame(): Promise<CapturedFrame>;
}

export interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
  atBottom: boolean;
}

export interface ScrollAdapter {
  scrollBy(deltaY: number): Promise<ScrollState>;
  getState?(): Promise<ScrollState>;
}

export interface ScrollshotSessionOptions {
  stitch?: StitchOptions;
  onProgress?: (progress: ScrollshotProgress) => void;
}

export interface ManualScrollshotOptions extends ScrollshotSessionOptions {
  sampleIntervalMs?: number;
  maxFrames?: number;
}

export interface AutomaticScrollshotOptions extends ScrollshotSessionOptions {
  scrollStepPx?: number;
  settleMs?: number;
  maxFrames?: number;
}

export interface ScrollshotSessionResult {
  image: PixelImage;
  plan: StitchPlan;
  frames: CapturedFrame[];
  warnings: string[];
}
