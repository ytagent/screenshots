# Scrollshot Next Steps

## Highest Priority

1. Add a real desktop GitHub Actions smoke test that opens an Electron fixture window, starts scrollshot from the toolbar, scrolls the selected region, finishes, and uploads the output image.
2. Implement Windows automatic scrolling:
   - locate scrollable target under selected bounds;
   - try UI Automation `ScrollPattern`;
   - fall back to wheel input;
   - report platform limitation when neither path is available.
3. Improve manual UX:
   - show a small controller outside the capture rect when possible;
   - keep Enter/Esc as reliable global fallbacks;
   - surface low-confidence warnings before failing.
4. Add real macOS verification:
   - ScreenCaptureKit capture adapter;
   - Accessibility scroll adapter;
   - explicit permission failure reporting.

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
