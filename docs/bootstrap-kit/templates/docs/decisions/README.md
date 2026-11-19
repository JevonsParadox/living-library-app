# Architecture Decision Records

Why we made each non-obvious call. Short, terse, dated.

## Format

```
# ADR-NNNN: Title
Date: YYYY-MM-DD
Status: Accepted | Superseded by ADR-XXXX | Reverted

## Context — one paragraph on the situation.
## Decision — one paragraph on what we chose.
## Consequences — one paragraph on the trade-off accepted.
```

## When to write a new one

- A non-obvious tech choice that future-you (or your AI agent) would re-litigate.
- A pattern that contradicts what would be the default guess.
- A "no" decision worth recording so we don't relitigate it.
- A migration / deferral with conditions for when to revisit.

Don't write ADRs for: small bug fixes, dependency bumps, naming choices, refactors that don't change behaviour.

## Index

| # | Date | Status | Title |
|---|---|---|---|
| [0001](0001-pin-security-sensitive-deps.md) | (date) | Accepted | Pin security-sensitive deps to exact versions |
| [0002](0002-ignore-scripts-as-primary-defence.md) | (date) | Accepted | `ignore-scripts=true` as primary supply-chain defence |
| [0003](0003-rls-in-every-migration.md) | (date) | Accepted | RLS enabled + read policy in the same migration as the table |
| [0004](0004-fail-loud-in-dev.md) | (date) | Accepted | Fail loud in dev when critical server-side data degrades silently |
