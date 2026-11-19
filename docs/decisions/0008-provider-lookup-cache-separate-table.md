# ADR-008: Provider lookup cache as a separate table from `nb_source_records`
Date: 2026-05-12
Status: Accepted

## Context
`previewAddCandidates` (the OpenLibrary + Google Books lookup behind the "Add to universe" CTA and the CSV batch resolve) was not compounding across users — every search re-fetched. The existing `nb_source_records` table holds provider payloads but is keyed to a `work_id`, meaning it can only hold data for books that already have a shell. We needed a cache for *speculative* lookups where no shell exists yet.

## Decision
New migration `00400_provider_lookup_cache.sql` creates `nb_provider_lookup_cache(query_hash text pk, query_text text, raw_candidates jsonb, fetched_at timestamptz)`. Keyed by `sha256(normaliseTitle | normaliseAuthor)`. 30-day TTL enforced at read. `previewAddCandidates` becomes read-through: check cache → return on fresh hit → otherwise fetch OL+GB and upsert.

## Consequences
Two parallel caches with slightly different purposes — `nb_source_records` for shell-attached provenance, `nb_provider_lookup_cache` for pre-shell speculative work. Acceptable separation: their decay rates and query keys differ. Future-deduping the two would be trivial if we ever want to.
