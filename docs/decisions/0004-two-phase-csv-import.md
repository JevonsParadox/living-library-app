# ADR-004: Two-phase CSV import: resolve → categorise → commit
Date: 2026-05-13
Status: Accepted

## Context
Initial batch "Add all to universe" committed unmatched books to the user's shelf the moment a shell was created. The user couldn't categorise them (read / reading / wishlist / etc.) or review the auto-picked candidates before commit — a green tick disappeared the row entirely. Users with 35-book CSVs ended up with 35 books on their shelf at the bulk default state with no opportunity to correct.

## Decision
Split the flow into two phases. Phase 1 (batch resolve): `previewAddCandidates` + `createShellFromProvider` per row, results stored in `resolvedShells: Map<idx, ResolvedShellRow>` carrying full `NbBookWithCoords` data + CSV hint. Resolved rows migrate into the matched list, pre-selected. Phase 2 (categorise + commit): user adjusts bulk default and per-row state via the existing matched-row UI, then clicks the single top-level "Add N books to shelf" to fire `addToNebulaShelf` + `addToShelf` in a staggered cascade (see ADR-006).

## Consequences
One extra click for trivial imports, but matches the natural mental model used for originally-matched rows and gives correctability before commit. `resolvedShells` carries full coord data so the commit-time defensive `addBookToGalaxy` call has what it needs even if the batch loop's earlier call somehow missed.
