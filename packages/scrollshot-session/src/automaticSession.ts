import { stitchFrames } from "scrollshot-core";
import type {
  AutomaticScrollshotOptions,
  CapturedFrame,
  FrameCaptureAdapter,
  ScrollAdapter,
  ScrollshotProgress,
  ScrollshotSessionResult,
} from "./types";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AutomaticScrollshotSession {
  private readonly frames: CapturedFrame[] = [];
  private cancelled = false;

  public constructor(
    private readonly captureAdapter: FrameCaptureAdapter,
    private readonly scrollAdapter: ScrollAdapter,
    private readonly options: AutomaticScrollshotOptions = {},
  ) {}

  public cancel(): void {
    this.cancelled = true;
    this.report({ state: "cancelled", message: "automatic scrollshot cancelled" });
  }

  public async run(): Promise<ScrollshotSessionResult> {
    const maxFrames = this.options.maxFrames ?? 90;
    const settleMs = this.options.settleMs ?? 120;
    const scrollStepPx = this.options.scrollStepPx ?? 520;
    let atBottom = false;

    while (!this.cancelled && this.frames.length < maxFrames) {
      this.report({ state: "capturing", message: "capturing frame" });
      this.frames.push(await this.captureAdapter.captureFrame());

      const state = this.scrollAdapter.getState
        ? await this.scrollAdapter.getState()
        : undefined;
      if (state?.atBottom || atBottom) {
        break;
      }

      this.report({ state: "scrolling", message: "scrolling target" });
      const nextState = await this.scrollAdapter.scrollBy(scrollStepPx);
      atBottom = nextState.atBottom;
      await delay(settleMs);
    }

    if (this.cancelled) {
      throw new Error("automatic scrollshot cancelled");
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
      message: "automatic scrollshot finished",
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
