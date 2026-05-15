# Scrollshot Release Audit

## Evidence Collected

- Repository structure separates `scrollshot-core`, `scrollshot-session`, `electron-screenshots`, and `react-screenshots`.
- The normal screenshot toolbar includes a long screenshot action after the user selects a region.
- Manual-assisted region capture is wired through `electron-screenshots`, hides the overlay, samples the selected bounds, stitches frames, and emits the existing `ok` path.
- Controlled Electron automatic capture uses `ElectronControlledContentAdapter` plus `AutomaticScrollshotSession`.
- Deterministic eval writes `artifacts/latest/eval-results.json`, `summary.md`, PNG artifacts, stitch plans, frame logs, and failure metadata.
- Real desktop smoke writes `artifacts/latest/electron-smoke/` for toolbar/manual flow.
- Controlled automatic smoke writes `artifacts/latest/electron-auto-smoke/`.

## Current Quality Gate Status

- Deterministic fixtures: pass when `pnpm eval:scrollshot` reports overall score >= 0.985 and zero critical failures.
- Manual toolbar desktop flow: verified by `pnpm smoke:scrollshot` and GitHub Actions on Linux, Windows, and macOS.
- Controlled Electron automatic flow: verified by `pnpm smoke:scrollshot` through `electron-auto-smoke`.
- OS-level external-window automatic flow: not complete.

## Remaining Release Blockers

- Windows external-window automatic scrolling still needs a real adapter that can identify the selected target and drive UI Automation `ScrollPattern` or a wheel fallback.
- macOS external-window automatic scrolling still needs ScreenCaptureKit capture and Accessibility scrolling with explicit permission handling.
- The hidden-overlay manual UX should get a small non-captured controller or equivalent global finish/cancel polish before a production release.

## Exact Continuation Prompt

Continue the scrollshot release goal from `docs/scrollshot-release-audit.md`: implement and verify OS-level external-window automatic scrolling, starting with Windows UI Automation plus SendInput wheel fallback, without weakening `pnpm eval:scrollshot` or `pnpm smoke:scrollshot`.
