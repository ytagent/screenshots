# Scrollshot Release Audit

## Evidence Collected

- Repository structure separates `scrollshot-core`, `scrollshot-session`, `electron-screenshots`, and `react-screenshots`.
- The normal screenshot toolbar includes a long screenshot action after the user selects a region.
- Manual-assisted region capture is wired through `electron-screenshots`, hides the overlay, samples the selected bounds, stitches frames, and emits the existing `ok` path.
- Manual-assisted mode shows a small finish/cancel controller outside the selected capture rect when safe screen space is available, with Enter/Esc fallback.
- External automatic mode is available through `longScreenshotMode: "auto" | "manual" | "automatic"`. `auto` tries platform wheel scrolling then falls back to manual, while `automatic` fails clearly if the platform cannot move the selected target.
- Windows has an external wheel fallback adapter that moves the cursor to the selected region center and sends wheel input without DOM access.
- The Electron smoke harness writes `artifacts/latest/electron-external-auto-smoke/` and enforces that external automatic mode produces a correct long image on Windows.
- Controlled Electron automatic capture uses `ElectronControlledContentAdapter` plus `AutomaticScrollshotSession`.
- Deterministic eval writes `artifacts/latest/eval-results.json`, `summary.md`, PNG artifacts, stitch plans, frame logs, and failure metadata.
- Real desktop smoke writes `artifacts/latest/electron-smoke/` for toolbar/manual flow.
- Controlled automatic smoke writes `artifacts/latest/electron-auto-smoke/`.

## Current Quality Gate Status

- Deterministic fixtures: pass when `pnpm eval:scrollshot` reports overall score >= 0.985 and zero critical failures.
- Manual toolbar desktop flow: verified by `pnpm smoke:scrollshot` and GitHub Actions on Linux, Windows, and macOS. The smoke result includes `controllerShown` and `finishedWithController` for the non-captured controller path.
- External automatic Windows wheel flow: verified by `pnpm smoke:scrollshot` on Windows through `electron-external-auto-smoke`.
- Controlled Electron automatic flow: verified by `pnpm smoke:scrollshot` through `electron-auto-smoke`.
- OS-level external-window automatic flow: partially complete. Windows wheel fallback is implemented and verified; Windows UI Automation and macOS Accessibility/ScreenCaptureKit are still not complete.

## Remaining Release Blockers

- Windows external-window automatic scrolling still needs a UI Automation `ScrollPattern` adapter that can identify and drive the selected scrollable target before falling back to wheel input.
- macOS external-window automatic scrolling still needs ScreenCaptureKit capture and Accessibility scrolling with explicit permission handling.
- Full-screen or near-full-screen manual selections should get an additional tray/menu-bar fallback because the non-captured controller is intentionally skipped when no safe off-rect position exists.

## Exact Continuation Prompt

Continue the scrollshot release goal from `docs/scrollshot-release-audit.md`: add a Windows UI Automation `ScrollPattern` adapter ahead of the existing wheel fallback, then implement a macOS Accessibility/ScreenCaptureKit validation path without weakening `pnpm eval:scrollshot` or `pnpm smoke:scrollshot`.
