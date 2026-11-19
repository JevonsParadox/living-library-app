# ADR-003: Stay on Next.js; reject Go + HTMX migration
Date: 2026-05-14
Status: Accepted

## Context
After the `nb_book_embeddings` RLS critical alert, the question came up: would migrating the backend to Go + HTMX materially reduce supply-chain risk (no `postinstall`, single immutable module proxy, much smaller transitive dep graph)? Yes — but capped, because the 3D galaxy is the product and it's locked to JS (Three.js + React Three Fiber + react-force-graph-2d). HTMX can't drive 60fps WebGL animations from the server.

## Decision
Stay on Next.js + harden it. The hardening plan (ADR-001, ADR-002, `.githooks/`, Socket CI firewall, Dependabot, RLS posture) achieves ~85% of the supply-chain benefit a Go rewrite would deliver, in 2 days vs 5–8 weeks, with zero rewrite risk and no loss of velocity. A Go-backend hybrid (Go for non-UI APIs; JS for the canvas) caps at ~70-80% benefit because the 3D layer keeps the bulk of the npm surface.

## Consequences
Continue paying the npm supply-chain tax forever — but with `.npmrc`, Socket, and pinned deps making the tax small. Revisit only if the 3D layer ever becomes server-renderable (it won't).
