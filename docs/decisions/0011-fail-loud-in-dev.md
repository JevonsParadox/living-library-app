# ADR-011: Fail loud in dev when catalog reads degrade silently
Date: 2026-05-18
Status: Accepted

## Context
`lib/supabase-server.ts:createAuthClient` catches a failed Clerk JWT token fetch (`auth().getToken({ template: "supabase" })`) and falls back to an anon Supabase client. The fallback is deliberate — a transient Clerk API hiccup shouldn't take the universe down for legitimate users. But every public-schema RLS policy is `to authenticated`, so anon's SELECT silently returns empty arrays. A *persistent* misconfig (e.g. the JWT template doesn't exist in Clerk at all) produces a UI where every region-derived label reads "Unknown" with no clear cause. We chased this exact symptom across two sessions before identifying it; the cost was real time and frustration.

## Decision
Add `components/nebula/MissingRegionsBanner.tsx` — a dev-only diagnostic banner that mounts on every Nebula page and surfaces only when `regions.length === 0`. The banner tells the developer the most likely cause (JWT template missing) and points at this ADR for the fix path. Gated on `process.env.NODE_ENV !== "production"` so production behaviour is unchanged (real Clerk hiccups still degrade gracefully without alarming real users).

## Consequences
Future JWT-template / RLS / catalog-read failures become impossible to miss in dev. The cost is ~50 lines of code and a dead component on every prod render (returns null early on the env check). Production silent-fallback semantics are preserved per the original `lib/supabase-server.ts:33-39` rationale.

## Fix path for the symptom this banner catches
1. Clerk Dashboard → Configure → JWT Templates.
2. New template → select the **Supabase** preset.
3. Name must be exactly `supabase` (matches `lib/supabase-server.ts:44`).
4. Signing algorithm `HS256`, signing key = Supabase JWT Secret (Supabase Dashboard → Project Settings → API → JWT Secret).
5. Save. Restart `npm run dev`. Banner disappears, regions load, labels resolve.

Do this in both Development and Production Clerk instances before launch.
