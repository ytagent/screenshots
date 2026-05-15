# Scrollshot Architecture

## Current User Flow

1. The user starts the normal Electron screenshot overlay.
2. The user selects a region.
3. The existing floating toolbar shows a long screenshot button.
4. Clicking it starts scrollshot mode for that selected region.
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
  - Electron controlled-content capture and scroll adapter for pages owned by the app.
  - NativeImage conversion and platform adapter scaffolding.
  - Windows/macOS external scroll adapters remain isolated stubs until they can be verified on those OSes.

- `react-screenshots`
  - Toolbar entry point.
  - User instructions/progress surface.
  - IPC call through preload.

## Implemented Capture Paths

The implemented user-facing product path is manual-assisted external region capture:

- capture source: existing `node-screenshots` path, with Electron `desktopCapturer` fallback;
- crop source: selected overlay bounds converted from DIP to native image pixels;
- sampling: 300 ms interval, up to 80 frames;
- finish/cancel: global Enter/Esc accelerators during capture;
- output: stitched PNG sent through the existing `ok` event and copied to clipboard unless the stitch plan reports warnings.

This path is intentionally conservative: a low-confidence stitch produces `longScreenshotFailed` instead of a corrupted image.

The implemented automatic path is for controlled Electron content:

- capture source: `webContents.capturePage`;
- scroll source: `webContents.executeJavaScript` with window scroll state;
- bottom detection: page scroll position plus viewport height;
- output: the same shared `scrollshot-session` and `scrollshot-core` stitching code.

This path is verified by the Electron smoke test as `artifacts/latest/electron-auto-smoke/`. It proves the automatic session and controlled-content adapter. It does not claim OS-level external-window automatic scrolling.

## Evaluation

Run:

```bash
pnpm eval:scrollshot
pnpm smoke:scrollshot
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
- `electron-smoke/` for real toolbar/manual desktop flow evidence
- `electron-auto-smoke/` for controlled Electron automatic flow evidence

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

Windows is verified in CI for the deterministic core eval, the real Electron toolbar/manual flow, and the controlled Electron automatic flow. External-window automatic scrolling is still scaffolded. The next implementation step is a Windows scroll adapter that tries UI Automation `ScrollPattern` first, then a wheel fallback.

macOS is verified in CI for the deterministic core eval, the real Electron toolbar/manual flow, and the controlled Electron automatic flow. OS-level external-window automatic scrolling is not claimed as complete. Future macOS work must implement and verify ScreenCaptureKit capture and Accessibility scrolling after permissions are available on real macOS.

Reference docs used while designing the adapters:

- Electron `desktopCapturer`: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron `webContents.capturePage`: https://www.electronjs.org/docs/latest/api/web-contents
- Electron `nativeImage`: https://www.electronjs.org/docs/latest/api/native-image
- Microsoft UI Automation `ScrollPattern.Scroll`: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.scrollpattern.scroll
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit

## Known Gaps

- Automatic OS-level external-window scrolling is scaffolded, not complete.
- Windows UI Automation / SendInput scrolling is not implemented.
- macOS ScreenCaptureKit / Accessibility scrolling is not implemented.
- The product path currently uses keyboard finish/cancel while the overlay is hidden. A release UX should add a small non-captured controller or tray/global hotkey polish.
- The real desktop smoke tests drive an Electron fixture window, but they do not drive OS-level external-window automatic scrolling.
