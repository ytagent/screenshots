# Scrollshot Release Audit

## Evidence Collected

- Repository structure separates `scrollshot-core`, `scrollshot-session`, `electron-screenshots`, and `react-screenshots`.
- The normal screenshot toolbar includes a long screenshot action after the user selects a region.
- Manual-assisted region capture is wired through `electron-screenshots`, hides the overlay, samples the selected bounds, stitches frames, and emits the existing `ok` path.
- Manual-assisted mode shows a small finish/cancel controller outside the selected capture rect when safe screen space is available, with app-menu and Enter/Esc fallbacks. The controller displays frame count, the current instruction/progress message, and the latest warning.
- External automatic mode is available through `longScreenshotMode: "auto" | "manual" | "automatic"`. `auto` tries platform wheel scrolling then falls back to manual, while `automatic` fails clearly if the platform cannot move the selected target.
- Windows has an external adapter that tries UI Automation `ScrollPattern` at the selected region center, then falls back to wheel input without DOM access.
- External automatic runs expose `longScreenshotScrollDiagnostics`, including selected point/display metadata, adapter attempts, Windows UI Automation target metadata, wheel fallback details, macOS Accessibility target/action metadata, and CoreGraphics event output.
- The macOS external-auto smoke runs a ScreenCaptureKit `SCShareableContent` probe, records Accessibility/CoreGraphics diagnostics, and verifies a correct OS-level external automatic long image on the hosted macOS desktop when the runner does not place a system prompt over the selected target.
- The Electron smoke harness writes `artifacts/latest/electron-external-auto-smoke/` and enforces that external automatic mode produces a correct long image on Windows and macOS. It still records explicit macOS environment-blocked skips for diagnosed hosted-runner limits: missing Accessibility trust, a system notification/dialog intercepting the selected point, or trusted Accessibility/CoreGraphics scroll attempts that are accepted but do not move the selected target region.
- Controlled Electron automatic capture uses `ElectronControlledContentAdapter` plus `AutomaticScrollshotSession`.
- Deterministic eval writes `artifacts/latest/eval-results.json`, `summary.md`, PNG artifacts, stitch plans, frame logs, and failure metadata.
- Real desktop smoke writes `artifacts/latest/electron-smoke/` for toolbar/manual flow.
- Controlled automatic smoke writes `artifacts/latest/electron-auto-smoke/`.

## Current Quality Gate Status

- Deterministic fixtures: pass when `pnpm eval:scrollshot` reports overall score >= 0.985 and zero critical failures.
- Manual toolbar desktop flow: verified by `pnpm smoke:scrollshot` and GitHub Actions on Linux, Windows, and macOS. The smoke result includes `controllerShown`, `finishedWithController`, and `controllerProgressSnapshot` for the non-captured controller path.
- External automatic Windows OS-level flow: verified by `pnpm smoke:scrollshot` on Windows through `electron-external-auto-smoke`; the artifact records which scroll method was used.
- External automatic macOS OS-level flow: verified by GitHub Actions on macOS through `electron-external-auto-smoke`; the artifact records ScreenCaptureKit success, actual/expected `320x2640`, score `0.9988124489379085`, and `macos-cgevent-scroll`.
- Controlled Electron automatic flow: verified by `pnpm smoke:scrollshot` through `electron-auto-smoke`.
- OS-level external-window automatic flow: verified in CI for Windows and macOS against OS-level external targets. Windows uses UI Automation plus wheel fallback. macOS uses ScreenCaptureKit probing, Accessibility preflight/action diagnostics, and CoreGraphics scroll posting with `ELECTRON_SCREENSHOTS_MACOS_SCROLL_STRATEGY` for method comparison.

## Residual Follow-ups

- No release blockers remain for the implemented supported paths: deterministic core eval, manual toolbar flow, controlled automatic flow, Windows external automatic flow, and macOS external automatic flow against an OS-level external target all pass in CI.
- Broader macOS native-app matrix coverage is still valuable future hardening, especially third-party scroll views and permission states outside the hosted Electron target.
- A tray icon fallback remains optional future UX for environments where the app-menu fallback is not reachable during full-screen capture.

## Future Hardening Prompt

Continue scrollshot hardening from `docs/scrollshot-release-audit.md`: broaden macOS external-window automatic scrolling verification beyond the hosted Electron target into a real signed/permissioned native desktop app matrix, keep the ScreenCaptureKit probe and scroll diagnostics intact, and do not weaken `pnpm eval:scrollshot` or `pnpm smoke:scrollshot`.
