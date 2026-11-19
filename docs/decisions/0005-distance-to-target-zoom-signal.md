# ADR-005: Zoom level from camera-to-target distance, not camera-to-origin
Date: 2026-05-13
Status: Accepted

## Context
`zoomLevel` was polled from `cameraDirectionRef.current.position.length()` — the camera's distance from world origin (0, 0, 0). This worked when the galaxy was centred at origin, but the moment the camera flew to a far-from-origin cluster (any region anchor, e.g. fantasy at world `(7.5, -5, 12.5)`), `position.length()` exceeded `GALAXY_THRESHOLD = 5` and flipped `zoomLevel` to `"galaxy"` — even though the user was right next to the cluster. `BookCloud`, `IlluminationEdges`, `SimilarReadsEdges`, `SelectedSeriesEdges`, and `SeriesLabels` are all gated on `zoomLevel !== "galaxy"`, so they all vanished simultaneously, producing the "no stars, no neighbours, blank space" symptom.

## Decision
Add `distanceToTarget: number` to `CameraDirectionData`. `CameraController` writes `camera.position.distanceTo(controlsRef.current.target)` to it each frame. The polling effect in `nebula-context.tsx` reads `distanceToTarget` instead of `position.length()`. Fallback to `position.length()` for the single frame before `OrbitControls` mounts.

## Consequences
Zoom level now correctly reflects "how zoomed in" regardless of where the user is looking. Manual OrbitControls pans away from origin no longer trigger spurious galaxy-mode hiding. Also fixes the previously-broken flythrough-to-cluster behaviour.
