# Scrollshot Next Steps

## Highest Priority

1. Improve Windows external-window automatic scrolling beyond the current UI Automation + wheel fallback:
   - locate the scrollable target under selected bounds;
   - add richer diagnostics when UI Automation `ScrollPattern` is unavailable;
   - keep the implemented wheel input path as fallback;
   - report platform limitation when neither path is available.
2. Improve manual UX:
   - consider a tray icon fallback for environments where the app-menu fallback is not reachable;
   - surface low-confidence warnings before failing.
3. Add real macOS external-window automatic scrolling:
   - ScreenCaptureKit capture adapter;
   - Accessibility scroll adapter;
   - explicit permission failure reporting.
4. Keep the real desktop GitHub Actions smoke tests green:
   - toolbar/manual flow writes `artifacts/latest/electron-smoke/`;
   - toolbar/manual flow verifies the non-captured controller can finish the session;
   - Windows external automatic wheel flow writes `artifacts/latest/electron-external-auto-smoke/`;
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
