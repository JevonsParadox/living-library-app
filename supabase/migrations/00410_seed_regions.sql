-- ============================================================
-- Seed the 14 canonical Nebula regions
-- ============================================================
-- Until now the only place nb_regions got populated was
-- scripts/nebula/seed-nebula-from-csv.ts (a one-off script that
-- doesn't run as part of migrations). Fresh databases or partial
-- seeds ended up with an empty / sparse regions table, which broke:
--   * createShellFromProvider — no regionRow → null coords on new
--     shells → batch CSV import rejects every row
--   * RegionPlanets — nothing to render → "blank space" symptom
--
-- Names + anchor positions + colors lifted from
-- scripts/nebula/seed-nebula-from-csv.ts:46-59 (original definitions)
-- but using the SHORT names from
-- scripts/nebula/update-region-names.ts (current production naming).
-- See ADR-010 for the rendering posture this enables.
--
-- Idempotent via ON CONFLICT (slug): re-running refreshes names /
-- anchors / colors without disturbing region_id references.

INSERT INTO nb_regions (name, slug, anchor_x, anchor_y, anchor_z, color_hex, sort_order)
VALUES
  ('Mythic Fantasy',  'mythic-fantasy',   -0.90, -0.45,  0.10, '#8B5CF6',  0),
  ('Cozy Fantasy',    'cozy-fantasy',     -0.85, -0.60, -0.35, '#F9A8D4',  1),
  ('Urban Fantasy',   'urban-fantasy',    -0.70, -0.10, -0.05, '#60A5FA',  2),
  ('Epic Fantasy',    'epic-fantasy',     -0.80,  0.10,  0.80, '#34D399',  3),
  ('Grimdark',        'grimdark-fantasy', -0.72,  0.30,  0.88, '#6B7280',  4),
  ('Romantasy',       'romantasy',        -0.68, -0.10,  0.20, '#F472B6',  5),
  ('Science Fantasy', 'science-fantasy',  -0.10,  0.00,  0.45, '#A78BFA',  6),
  ('Dystopian',       'dystopian',         0.35,  0.05,  0.35, '#EF4444',  7),
  ('First Contact',   'philosophical-sf',  0.55,  0.20,  0.40, '#06B6D4',  8),
  ('Space Opera',     'space-opera',       0.75,  0.15,  0.82, '#3B82F6',  9),
  ('Military SF',     'military-sf',       0.78,  0.55,  0.78, '#78716C', 10),
  ('Hard SF',         'hard-sf',           0.90,  0.82,  0.52, '#14B8A6', 11),
  ('Cyberpunk',       'cyberpunk',         0.82,  0.58, -0.05, '#F59E0B', 12),
  ('Weird Fiction',   'weird-spec',        0.10, -0.20,  0.18, '#EC4899', 13)
ON CONFLICT (slug) DO UPDATE SET
  name       = EXCLUDED.name,
  anchor_x   = EXCLUDED.anchor_x,
  anchor_y   = EXCLUDED.anchor_y,
  anchor_z   = EXCLUDED.anchor_z,
  color_hex  = EXCLUDED.color_hex,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
