-- ============================================================
-- Provider lookup cache — compounding catalog phase 1
-- ============================================================
-- Speculative cache for OpenLibrary + Google Books title/author searches
-- triggered by previewAddCandidates(). Lets us avoid re-hitting external
-- providers when a different user (or the same user later) previews the
-- same query, even if no shell was ever created from the previous preview.
--
-- Distinct from nb_source_records: that table attaches raw payloads to a
-- created work (post-shell provenance). This one is keyed only by the
-- search query and exists before any shell does.
--
-- TTL is enforced by the read path filtering on fetched_at; we keep stale
-- rows around for debugging / future re-derivation rather than running
-- a delete job.

create table nb_provider_lookup_cache (
  -- sha256("normalised_title|normalised_author"), application-computed.
  query_hash    text primary key,
  -- Human-readable form for debugging only — never used as a lookup key.
  query_text    text not null,
  -- Array of ProviderCandidate JSON (the same shape returned to the client
  -- by previewAddCandidates). Stored as jsonb so we can index if needed.
  raw_candidates jsonb not null,
  fetched_at    timestamptz not null default now()
);

create index nb_provider_lookup_cache_fetched_idx
  on nb_provider_lookup_cache (fetched_at);

alter table nb_provider_lookup_cache enable row level security;
-- Service-role only, mirroring nb_source_records. The cache is written by
-- the previewAddCandidates server action under a service client; clients
-- never read it directly.
