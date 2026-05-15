# Scrollshot Release Audit

## Evidence Collected

- Repository structure separates `scrollshot-core`, `scrollshot-session`, `electron-screenshots`, and `react-screenshots`.
- The normal screenshot toolbar includes a long screenshot action after the user selects a region.
- Manual-assisted region capture is wired through `electron-screenshots`, hides the overlay, samples the selected bounds, stitches frames, and emits the existing `ok` path.
- Manual-assisted mode shows a small finish/cancel controller outside the selected capture rect when safe screen space is available, with app-menu and Enter/Esc fallbacks.
- External automatic mode is available through `longScreenshotMode: "auto" | "manual" | "automatic"`. `auto` tries platform wheel scrolling then falls back to manual, while `automatic` fails clearly if the platform cannot move the selected target.
- Windows has an external adapter that tries UI Automation `ScrollPattern` at the selected region center, then falls back to wheel input without DOM access.
- The Electron smoke harness writes `artifacts/latest/electron-external-auto-smoke/` and enforces that external automatic mode produces a correct long image on Windows.
- Controlled Electron automatic capture uses `ElectronControlledContentAdapter` plus `AutomaticScrollshotSession`.
- Deterministic eval writes `artifacts/latest/eval-results.json`, `summary.md`, PNG artifacts, stitch plans, frame logs, and failure metadata.
- Real desktop smoke writes `artifacts/latest/electron-smoke/` for toolbar/manual flow.
- Controlled automatic smoke writes `artifacts/latest/electron-auto-smoke/`.

## Current Quality Gate Status

- Deterministic fixtures: pass when `pnpm eval:scrollshot` reports overall score >= 0.985 and zero critical failures.
- Manual toolbar desktop flow: verified by `pnpm smoke:scrollshot` and GitHub Actions on Linux, Windows, and macOS. The smoke result includes `controllerShown` and `finishedWithController` for the non-captured controller path.
- External automatic Windows OS-level flow: verified by `pnpm smoke:scrollshot` on Windows through `electron-external-auto-smoke`; the artifact records which scroll method was used.
- Controlled Electron automatic flow: verified by `pnpm smoke:scrollshot` through `electron-auto-smoke`.
- OS-level external-window automatic flow: partially complete. Windows UI Automation plus wheel fallback is implemented and the Windows flow is verified; macOS Accessibility/ScreenCaptureKit is still not complete.

## Remaining Release Blockers

- Windows external-window automatic scrolling still needs richer target diagnostics for cases where UI Automation `ScrollPattern` is unavailable and the adapter falls back to wheel input.
- macOS external-window automatic scrolling still needs ScreenCaptureKit capture and Accessibility scrolling with explicit permission handling.
- A tray icon fallback is still optional future UX for environments where the app-menu fallback is not reachable during full-screen capture.

## Exact Continuation Prompt

Continue the scrollshot release goal from `docs/scrollshot-release-audit.md`: implement a macOS Accessibility/ScreenCaptureKit validation path and add richer target diagnostics without weakening `pnpm eval:scrollshot` or `pnpm smoke:scrollshot`.
