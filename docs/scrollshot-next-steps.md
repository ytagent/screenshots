# Scrollshot Next Steps

## Highest Priority

1. Verify macOS external-window automatic scrolling in a real signed/permissioned desktop environment:
   - grant Accessibility input control to the host app or signed test helper;
   - verify the trusted CoreGraphics or Accessibility scroll event actually moves the selected target region;
   - keep the ScreenCaptureKit `SCShareableContent` probe in the smoke artifact;
   - require a correct stitched output when Accessibility permission is available;
   - keep hosted-runner skips only for explicit environment blocks such as missing Accessibility trust or accepted scroll events that do not move the target.
2. Improve manual UX:
   - consider a tray icon fallback for environments where the app-menu fallback is not reachable;
   - surface low-confidence warnings before failing.
3. Improve external-window automatic diagnostics further:
   - locate and name the selected target window where platform APIs expose it;
   - keep Windows UI Automation `ScrollPattern` before wheel fallback;
   - report platform limitation when neither path is available.
4. Keep the real desktop GitHub Actions smoke tests green:
   - toolbar/manual flow writes `artifacts/latest/electron-smoke/`;
   - toolbar/manual flow verifies the non-captured controller can finish the session;
   - Windows external automatic wheel flow writes `artifacts/latest/electron-external-auto-smoke/`;
   - macOS external automatic smoke records ScreenCaptureKit, Accessibility, and CoreGraphics event diagnostics, and only skips when the hosted runner exposes a diagnosed environment block;
   - controlled Electron automatic flow writes `artifacts/latest/electron-auto-smoke/`;
   - Linux runs under Xvfb and Windows/macOS run on real hosted desktop sessions.

## Quality Gate

The deterministic core eval must stay at:

- overall score >= 0.985
- criticalFailures == 0
- missingRows == 0
- duplicatedRows == 0
- badSeams == 0
- markerCoverage >= 99.9%
- no premature cutoff
- no scale mismatch
- no success when confidence is low

Do not weaken the eval to improve the score. Improve the worst failing fixture first.
