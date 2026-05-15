# Scrollshot Architecture

## Current User Flow

1. The user starts the normal Electron screenshot overlay.
2. The user selects a region.
3. The existing floating toolbar shows a long screenshot button.
4. Clicking it starts scrollshot mode for that selected region.
5. The overlay briefly shows instructions, then hides so the underlying app can receive scroll input.
6. A small controller is shown outside the selected region when there is safe screen space; otherwise the app menu exposes finish/cancel actions.
7. In `auto` mode, the app first tries platform external wheel scrolling at the center of the selected region. If that cannot move the target, it falls back to manual-assisted capture. Developers can force `manual` or `automatic` with `longScreenshotMode`.
8. The app samples the selected display region repeatedly.
9. The user can manually scroll the target content, click Finish, press Enter, click Cancel, or press Esc.
10. The main process stitches captured frames and copies the final PNG to the clipboard through the existing `ok` path. Low-confidence results fail instead of being copied.

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
  - External automatic wheel scrolling adapter boundary for OS-level targets.
  - Electron controlled-content capture and scroll adapter for pages owned by the app.
  - NativeImage conversion and platform adapter implementations/scaffolding.
  - Windows `WindowsScrollAdapter` tries UI Automation `ScrollPattern` first, records target diagnostics, then falls back to the verified wheel input path.
  - macOS CoreGraphics `CGEvent` scroll adapter is isolated and performs an `AXIsProcessTrusted` preflight before attempting external automatic scrolling.

- `react-screenshots`
  - Toolbar entry point.
  - User instructions/progress surface.
  - IPC call through preload.

## Implemented Capture Paths

The implemented user-facing product path is manual-assisted external region capture:

- capture source: existing `node-screenshots` path, with Electron `desktopCapturer` fallback;
- crop source: selected overlay bounds converted from DIP to native image pixels;
- sampling: 300 ms interval, up to 80 frames;
- finish/cancel: non-captured controller window outside the capture rect when possible, app-menu fallback when no off-rect position exists, plus global Enter/Esc fallback;
- output: stitched PNG sent through the existing `ok` event and copied to clipboard unless the stitch plan reports warnings.

This path is intentionally conservative: a low-confidence stitch produces `longScreenshotFailed` instead of a corrupted image. If a selected region leaves no safe space for the controller, the controller window is skipped so it cannot pollute the capture, and the app-menu plus Enter/Esc fallbacks remain active.

The product path also supports external automatic mode:

- `longScreenshotMode: "auto"`: try platform wheel scrolling first, then fall back to manual capture if the target cannot be moved.
- `longScreenshotMode: "manual"`: keep the manual-assisted behavior only.
- `longScreenshotMode: "automatic"`: require platform wheel scrolling and fail with a clear reason if it is unavailable.

The external automatic path captures the selected region, sends OS-level wheel input at the region center, waits for content to settle, and stops after repeated visually stable frames. This avoids needing target-specific DOM access and keeps the stitching path shared.

Automatic runs expose `data.longScreenshotScrollMethods` and `data.longScreenshotScrollDiagnostics` on success. Failure events receive the same `ScreenshotsData` object with recent scroll diagnostics, so artifacts can show the selected point, display scale, adapter attempts, Windows UI Automation target metadata, wheel fallback details, and macOS Accessibility preflight results.

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
- `electron-external-auto-smoke/` for OS-level external automatic flow evidence where supported
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

Windows is verified in CI for the deterministic core eval, the real Electron toolbar/manual flow, the controlled Electron automatic flow, and the external automatic OS-level flow. The Windows adapter attempts UI Automation `ScrollPattern` first and falls back to wheel input when the selected target does not expose a scroll pattern. The external-auto artifact records the selected screen point, display scale, inspected UI Automation ancestors, the selected target, and the final scroll methods used.

macOS is verified in CI for the deterministic core eval, the real Electron toolbar/manual flow, and the controlled Electron automatic flow. The external-auto smoke now runs a ScreenCaptureKit `SCShareableContent` probe and attempts the product external-auto flow when possible, but it is allowed to record a permission-blocked skip when `AXIsProcessTrusted` shows the runner process is not trusted for Accessibility input control. OS-level external-window automatic scrolling is still not claimed as complete until a macOS runner or signed app environment grants Accessibility and the full long image is verified.

Reference docs used while designing the adapters:

- Electron `desktopCapturer`: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron `webContents.capturePage`: https://www.electronjs.org/docs/latest/api/web-contents
- Electron `nativeImage`: https://www.electronjs.org/docs/latest/api/native-image
- Microsoft UI Automation `ScrollPattern.Scroll`: https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.scrollpattern.scroll
- Apple ScreenCaptureKit: https://developer.apple.com/documentation/screencapturekit
- Apple `AXIsProcessTrustedWithOptions`: https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions

## Known Gaps

- Automatic OS-level external-window scrolling remains platform-dependent: the Windows path is verified, while macOS and Linux still have runtime permission/tooling gaps.
- Windows UI Automation `ScrollPattern` may not be available for every selected target; the verified fallback is wheel input at the selected region center, and diagnostics are emitted for both attempts.
- macOS ScreenCaptureKit probing and Accessibility preflight are implemented, but full external automatic scrolling remains unverified without Accessibility permission.
- Linux external automatic mode requires `xdotool`; CI records this path as skipped unless that runtime is available.
- Tray icon support is still optional future UX for environments where an app menu is not reachable during full-screen capture.
