# ADR-010: Always render every region planet; no count-zero gate
Date: 2026-05-15
Status: Accepted

## Context
`RegionPlanets.tsx` short-circuited any region with zero books in `state.books` (`if (count === 0) return null`). For a fresh user whose CSV-uploaded books all defaulted to one region (via the still-broken regex-based genre matcher in `createShellFromProvider`), every other region was invisible — no navigation landmarks. Combined with `BookCloud` being hidden at galaxy zoom and labels fading on zoom-in, users described it as "blank space, can't tell where anything is."

## Decision
Remove the count-zero gate. Every region planet renders unconditionally. Floor `t = Math.max(0.2, count / maxCount)` so empty regions aren't 30-px specks. Raise `regionPlanetIntensity` floors: `alphaFactor` 0.4 → 0.7, `haloFactor` 0.5 → 0.7. Floor 2D region label opacity at 0.4 so navigation cues survive zoom-in. Ungate `BookCloud` from `zoomLevel` (only gate `IlluminationEdges`, `SimilarReadsEdges`, `SelectedSeriesEdges`, `SeriesLabels`).

## Consequences
Slight rendering overhead (~14 always-present planets, ~12k always-present book dots). Acceptable: the navigational benefit dominates. Planet brightness still scales with shelf engagement above the floor — empty regions read as "available but unexplored", populated ones read as "this is where my reading lives".
