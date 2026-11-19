# ADR-0004: Fail loud in dev when critical server-side data degrades silently
Date: (set when you adopt this in your project)
Status: Accepted

## Context
The standard Clerk + Supabase integration uses `auth().getToken({ template: "supabase" })` to mint a Supabase-compatible JWT, which then authorises catalog reads through `to authenticated` RLS policies. If that token fetch fails (template missing, transient Clerk hiccup, etc.), the typical pattern is to fall back to an anon Supabase client so the app doesn't crash. But a *persistent* misconfig — most commonly: the JWT template was never set up in the Clerk dashboard — produces a UI where every read returns `[]` silently. RLS denies anon's SELECT with no error message, just an empty result set. The cost of chasing this symptom blind is high; better to surface it.

## Decision
Add a dev-only diagnostic UI surface (banner, console error, or both) that fires when critical server-side data arrives empty under conditions where it shouldn't. Production keeps the silent fallback by design — a real Clerk hiccup shouldn't paint a scary banner over real users' sessions. Gate on `process.env.NODE_ENV !== "production"`.

Pattern: identify the "spine" data that drives the UI's navigation framing (e.g. regions, categories, top-level entities). Watch its array length in a component mounted on every relevant page. If empty + we're in dev, surface a clear pointer at the most likely root cause (typically: "Clerk JWT template named `supabase` is missing — see docs/security/supply-chain.md").

## Consequences
Future JWT-template / RLS / catalog-read failures become impossible to miss in dev. The cost is ~50 lines of code per surface + a dead component on every prod render (returns null early on the env check). Production silent-fallback semantics are preserved.
