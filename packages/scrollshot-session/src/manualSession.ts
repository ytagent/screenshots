import { stitchFrames } from "scrollshot-core";
import type {
  CapturedFrame,
  FrameCaptureAdapter,
  ManualScrollshotOptions,
  ScrollshotProgress,
  ScrollshotSessionResult,
} from "./types";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ManualScrollshotSession {
  private readonly frames: CapturedFrame[] = [];
  private cancelled = false;
  private running = false;

  public constructor(
    private readonly captureAdapter: FrameCaptureAdapter,
    private readonly options: ManualScrollshotOptions = {},
  ) {}

  public async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.cancelled = false;
    const maxFrames = this.options.maxFrames ?? 80;
    const sampleIntervalMs = this.options.sampleIntervalMs ?? 280;

    while (!this.cancelled && this.frames.length < maxFrames) {
      this.report({ state: "capturing", message: "capturing frame" });
      this.frames.push(await this.captureAdapter.captureFrame());
      await delay(sampleIntervalMs);
    }
  }

  public cancel(): void {
    this.cancelled = true;
    this.running = false;
    this.report({ state: "cancelled", message: "manual scrollshot cancelled" });
  }

  public async finish(): Promise<ScrollshotSessionResult> {
    this.cancelled = true;
    this.running = false;
    if (this.frames.length === 0) {
      this.frames.push(await this.captureAdapter.captureFrame());
    }

    this.report({ state: "stitching", message: "stitching frames" });
    const stitched = stitchFrames(
      this.frames.map((frame, index) => ({ ...frame, index })),
      this.options.stitch,
    );
    const warnings = [...stitched.plan.warnings];
    this.report({
      state: "finished",
      frameCount: this.frames.length,
      warnings,
      message: "manual scrollshot finished",
    });
    return {
      image: stitched.image,
      plan: stitched.plan,
      frames: [...this.frames],
      warnings,
    };
  }

  private report(update: Partial<ScrollshotProgress>): void {
    this.options.onProgress?.({
      state: "idle",
      frameCount: this.frames.length,
      warnings: [],
      ...update,
    });
  }
}
