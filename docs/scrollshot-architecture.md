# Scrollshot Architecture

## Current User Flow

1. The user starts the normal Electron screenshot overlay.
2. The user selects a region.
3. The existing floating toolbar shows a long screenshot button.
4. Clicking it starts manual-assisted scrollshot mode for that selected region.
5. The overlay briefly shows instructions, then hides so the underlying app can receive scroll input.
6. The app samples the selected display region repeatedly.
7. The user scrolls the target content, presses Enter to finish, or presses Esc to cancel.
8. The main process stitches captured frames and copies the final PNG to the clipboard through the existing `ok` path. Low-confidence results fail instead of being copied.

## Package Boundaries

- `scrollshot-core`
  - Pixel image helpers.
  - Duplicate/overlap matching.
  - Sticky header row detection.
  - Stitch planning and composition.
  - Diff and score helpers for evaluation.

- `scrollshot-session`
  - Manual and automatic session orchestration interfaces.
  - Capture and scroll adapter contracts.
  - Progress and cancellation types.

- `electron-screenshots`
  - Existing screenshot overlay and display capture.
  - Region-based manual scrollshot capture from the selected bounds.
  - NativeImage conversion and adapter scaffolding.
  - Windows/macOS external scroll adapters remain isolated stubs until they can be verified on those OSes.

- `react-screenshots`
  - Toolbar entry point.
  - User instructions/progress surface.
  - IPC call through preload.

## Implemented Capture Path

The implemented product path is manual-assisted external region capture:

- capture source: existing `node-screenshots` path, with Electron `desktopCapturer` fallback;
- crop source: selected overlay bounds converted from DIP to native image pixels;
- sampling: 300 ms interval, up to 80 frames;
- finish/cancel: global Enter/Esc accelerators during capture;
- output: stitched PNG sent through the existing `ok` event and copied to clipboard unless the stitch plan reports warnings.

This path is intentionally conservative: a low-confidence stitch produces `longScreenshotFailed` instead of a corrupted image.

## Evaluation

Run:

```bash
pnpm eval:scrollshot
```

Artifacts are written to `artifacts/latest/`:

- `eval-results.json`
- `summary.md`
- `actual.png`
- `expected.png`
- `diff.png`
- `seams.png`
- `stitch-plan.json`
- per-fixture `frames/` and `log.json`

Fixtures currently include:

- `basic-long-page`
- `striped-markers`
- `sticky-header`
- `lazy-images`
- `nested-scroll`
- `virtualized-list`
- `chat-history-like`
- `pdf-like`
- `high-dpi-scale`

## Platform Notes

Windows is the first real external-window target. The next implementation step is a Windows scroll adapter that tries UI Automation `ScrollPattern` first, then a wheel fallback. Electron `desktopCapturer` is available as a capture source, and `webContents.capturePage` is the preferred path for controlled Electron content.

macOS is not claimed as verified. The architecture isolates future ScreenCaptureKit capture and Accessibility scrolling behind adapters. macOS work must verify Screen Recording and Accessibility permissions on real macOS before marking support complete.

Reference docs used while designing the adapters:

- Electron `desktopCapturer`: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron `webContents.capturePage`: https://www.electronjs.org/docs/latest/api/web-contents
- Electron `nativeImage`: https://www.electronjs.org/docs/latest/api/native-image
- Microsoft UI Automation `ScrollPattern.Scroll`: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.scrollpattern.scroll
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit

## Known Gaps

- Automatic external-window scrolling is scaffolded, not complete.
- macOS capture/scroll is scaffolded and unverified.
- The product path currently uses keyboard finish/cancel while the overlay is hidden. A release UX should add a small non-captured controller or tray/global hotkey polish.
- CI eval is deterministic and cross-platform, but it does not yet drive a real desktop app window with OS-level scrolling.
