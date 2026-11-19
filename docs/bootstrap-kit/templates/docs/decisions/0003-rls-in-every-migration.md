# ADR-0003: RLS enabled + read policy in the same migration as the table
Date: (set when you adopt this in your project)
Status: Accepted

## Context
Supabase tables in the `public` schema are reachable via the anon key over the public internet. Without row-level security, anyone with your project URL can SELECT (and depending on the table, INSERT / UPDATE / DELETE) every row. The failure mode is silent — the table just appears world-accessible until Supabase's automated security scanner emails you (or, worse, a researcher does).

## Decision
Every migration that creates a public-schema table MUST include `alter table <name> enable row level security` + at minimum a SELECT policy in the same migration. The default-deny posture (RLS on, no policies) is acceptable for service-role-only tables; otherwise add an explicit `for select to authenticated using (true)` or a tighter predicate. `CLAUDE.md`'s Security Rules capture this hard rule.

## Consequences
Migration files are slightly longer. RLS-by-default mistakes can't ship under this rule. Pattern to copy: `enable rls;` followed by `create policy "<name>" on <table> for select to authenticated using (true);` for read-global tables, or a `using (user_id = auth.uid())` predicate for per-user tables.
