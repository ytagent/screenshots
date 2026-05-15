# Scrollshot Next Steps

## Highest Priority

1. Implement Windows external-window automatic scrolling:
   - locate scrollable target under selected bounds;
   - try UI Automation `ScrollPattern`;
   - fall back to wheel input;
   - report platform limitation when neither path is available.
2. Improve manual UX:
   - show a small controller outside the capture rect when possible;
   - keep Enter/Esc as reliable global fallbacks;
   - surface low-confidence warnings before failing.
3. Add real macOS external-window automatic scrolling:
   - ScreenCaptureKit capture adapter;
   - Accessibility scroll adapter;
   - explicit permission failure reporting.
4. Keep the real desktop GitHub Actions smoke tests green:
   - toolbar/manual flow writes `artifacts/latest/electron-smoke/`;
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
