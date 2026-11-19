# ADR-006: Stagger commit cascade with optimistic `addToShelf`
Date: 2026-05-13
Status: Accepted

## Context
The CSV "Add 35 books to shelf" commit should play as a visible wave of ignitions — each book lights up in turn at a predictable 150ms cadence so the universe feels alive. The original sequential `await addToNebulaShelf → addToShelf` pattern made cadence jittery because per-book server latency dominated the timing (50ms–500ms per call).

## Decision
Decouple the visual cascade from the network. Per-iteration in `handleAddAll`:
1. `addBookToGalaxy(book)` — defensive, no-op if already present.
2. `addToShelf(bookId, ...)` — optimistic context update; fires the D1 ignition pulse + neighbour cascade immediately.
3. `void addToNebulaShelf(bookId, opts)` — fire-and-forget server write; cascade timing doesn't wait on it.
4. `await sleep(150)` before the next iteration.

Camera flies to the cluster centroid before the cascade starts (`CAMERA_GLIDE_MS = 1200`), then does a two-stage settle out to a wider frame after.

## Consequences
Cadence is now smooth regardless of network. If a server write fails, optimistic state holds until next page load reflects truth — same robustness as the sequential-await version, which also didn't check return values. The cascade visually completes in ~6.5s for 35 books; tunable via `COMMIT_STAGGER_MS`.
