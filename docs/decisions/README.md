# Architecture Decision Records

Why we made each non-obvious call. Short, terse, dated.

## Format

```
# ADR-NNN: Title
Date: YYYY-MM-DD
Status: Accepted | Superseded by ADR-XXX | Reverted

## Context — one paragraph on the situation.
## Decision — one paragraph on what we chose.
## Consequences — one paragraph on the trade-off accepted.
```

## When to write a new one

- A non-obvious tech choice that future-you (or me) would re-litigate.
- A pattern that contradicts what would be the default guess.
- A "no" decision worth recording so we don't relitigate it.

Don't write ADRs for: small bug fixes, dependency bumps, naming choices, refactors that don't change behaviour.

## Index

| # | Date | Status | Title |
|---|---|---|---|
| [001](0001-pin-security-sensitive-deps.md) | 2026-05-14 | Accepted | Pin security-sensitive deps to exact versions |
| [002](0002-ignore-scripts-as-primary-defence.md) | 2026-05-14 | Accepted | `ignore-scripts=true` as primary supply-chain defence |
| [003](0003-stay-on-nextjs-no-go-migration.md) | 2026-05-14 | Accepted | Stay on Next.js; reject Go + HTMX migration |
| [004](0004-two-phase-csv-import.md) | 2026-05-13 | Accepted | Two-phase CSV import: resolve → categorise → commit |
| [005](0005-distance-to-target-zoom-signal.md) | 2026-05-13 | Accepted | Zoom level from camera-to-target distance, not camera-to-origin |
| [006](0006-stagger-commit-cascade.md) | 2026-05-13 | Accepted | Stagger commit cascade with optimistic addToShelf |
| [007](0007-defer-context-mem.md) | 2026-05-15 | Accepted | Defer context-mem adoption; use built-in memory + ADRs |
| [008](0008-provider-lookup-cache-separate-table.md) | 2026-05-12 | Accepted | Provider lookup cache as a separate table from `nb_source_records` |
| [009](0009-rls-in-every-migration.md) | 2026-05-14 | Accepted | RLS enabled + read policy in the same migration as the table |
| [010](0010-always-render-region-planets.md) | 2026-05-15 | Accepted | Always render every region planet; no count-zero gate |
| [011](0011-fail-loud-in-dev.md) | 2026-05-18 | Accepted | Fail loud in dev when catalog reads degrade silently |
