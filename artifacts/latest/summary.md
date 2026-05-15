# Scrollshot Evaluation

Quality gate: PASS

| Metric | Value | Gate |
| --- | ---: | ---: |
| overallScore | 1.000000 | >= 0.985 |
| criticalFailures | 0 | 0 |
| missingRows | 0 | 0 |
| duplicatedRows | 0 | 0 |
| badSeams | 0 | 0 |
| markerCoverage | 1.000000 | >= 0.999 |

| Fixture | Result | Score | Frames | Actual Size | Critical Failures | Warnings |
| --- | --- | ---: | ---: | --- | ---: | --- |
| basic-long-page | pass | 1.000000 | 7 | 420x2920 | 0 | - |
| striped-markers | pass | 1.000000 | 8 | 420x3200 | 0 | - |
| sticky-header | pass | 1.000000 | 6 | 420x2440 | 0 | - |
| lazy-images | pass | 1.000000 | 7 | 420x2780 | 0 | - |
| nested-scroll | pass | 1.000000 | 8 | 420x3020 | 0 | - |
| virtualized-list | pass | 1.000000 | 7 | 420x2860 | 0 | - |
| chat-history-like | pass | 1.000000 | 7 | 420x2740 | 0 | - |
| pdf-like | pass | 1.000000 | 8 | 420x3240 | 0 | - |
| high-dpi-scale | pass | 1.000000 | 7 | 840x2980 | 0 | - |

Artifacts:
- Root comparison images mirror the striped marker fixture: actual.png, expected.png, diff.png, seams.png.
- Per-fixture artifacts are under artifacts/latest/fixtures/<fixture>/.
- stitch-plan.json includes frame count, capture rectangle, frame dimensions, device scale factor, offsets, overlap confidence, seam rows, duplicate frames, warnings, final height, and failure reason.
