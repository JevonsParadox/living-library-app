# Semantic 3D Library — Technical Design Packet

## Purpose
This document set defines the full technical design and roadmap for building a semantic 3D digital library focused initially on **science fiction and fantasy**. It is written as a reference packet for implementation by Claude and for future extension by engineering.

The product goal is to let users explore a persistent 3D universe of books where conceptual closeness is reflected by spatial proximity. Users can optionally upload their own shelf, see it appear inside the universe, and reveal a reading path through the world based on chronology, semantics, or a hybrid of both.

---

# Document 1 — Product and System Overview

## 1. Product vision
The application is a navigable 3D semantic universe of books. Books, series, authors, and clusters are positioned in 3D such that books with similar meaning, tone, structure, themes, and reader appeal appear close to one another.

The system always shows the global universe on the home page. When a user uploads books, a personal layer can be turned on to:
- reveal the user’s books inside the universe
- animate the shelf appearing in place
- draw a glowing path through the user’s books
- support recommendations around that path
- let the user move through the world by choosing recommendations

## 2. Initial scope
Initial domain:
- Science fiction
- Fantasy

Initial corpus:
- 5,000 books

Initial client experience:
- public or authenticated universe home page
- book search and local exploration
- optional user shelf upload and matching
- path visualization
- recommendation tray that can move the user through the 3D world

## 3. MVP requirements
The MVP must support:
- stable 3D semantic universe with 5,000 books
- series anchors
- multiple selectable edge types
- user upload flows
- chronology-aware path generation
- semantic path fallback when chronology is absent
- recommendation layer tied to the user path

## 4. MVP upload methods
The MVP supports four ingestion methods:
1. Photo of bookshelf
   - Claude image reads spines
   - outputs candidate list with confidence / accuracy rating
   - user confirms or rejects
2. Short video upload, approximately 30 seconds
   - frames extracted
   - near-duplicate frames removed
   - Claude image processes selected frames
   - outputs candidate list with confidence / accuracy rating
   - user confirms or rejects
3. Barcode scanning
   - single barcode scan using camera
   - resolves ISBN and canonical book
4. CSV upload
   - user uploads list of books
   - fuzzy matching resolves canonical book records

Optional metadata per uploaded book:
- date started
- date finished
- date read if only one date is known
- number of days to read if user inputs dates
- rating
- read status

## 5. Primary user flows
### 5.1 Global universe first
- User lands on the universe view
- Can explore clusters, regions, series, books
- Can search and navigate

### 5.2 Upload shelf
- User opens upload panel from side rail
- Chooses upload method
- System extracts candidate books with confidence
- User confirms / rejects / edits
- Confirmed books animate into the universe
- User may toggle “show my path”

### 5.3 Path and recommendation
- Shelf appears in world
- Path is drawn chronologically when available
- Semantic traversal supplements missing chronology
- Recommendation layer appears below
- User can accept a recommendation and be moved through space to it

## 6. Core system layers
The platform has three layers:
1. Global semantic world
2. User shelf and path overlay
3. Navigation and recommendation engine

---

# Document 2 — Architecture Overview

## 1. Recommended stack
Backend and pipelines:
- Python
- FastAPI
- SQLAlchemy or SQLModel
- Postgres
- pgvector
- Redis optional

Frontend:
- React
- Next.js optional but recommended
- React Three Fiber
- Three.js
- Zustand or Redux for state

Infrastructure:
- Supabase for Postgres and storage
- Clerk or Supabase Auth for auth
- Vercel for frontend deployment
- GitHub for version control and CI
- Pinecone optional for external vector workflows, though pgvector is enough for MVP

Recommended MVP preference based on current tools:
- Supabase: yes
- GitHub: yes
- Vercel: yes
- Clerk: yes
- Pinecone: optional, not necessary for MVP if pgvector is used

## 2. System decomposition
### Offline components
These prepare the global universe:
- metadata ingestion pipeline
- semantic enrichment pipeline
- embedding generation pipeline
- clustering and graph pipeline
- 3D coordinate generation pipeline
- seed data export pipeline

### Online backend services
These serve runtime interactions:
- authentication and user identity
- book search and retrieval
- world chunk retrieval
- shelf ingestion and canonical matching
- upload job processing
- user path generation
- recommendations and explanation service
- analytics and event logging

### Frontend client
The client provides:
- global universe viewer
- side upload drawer
- confirmation UI for extracted books
- path visualization controls
- recommendation tray and auto-navigation
- filtering by edge type and region

## 3. Core service boundaries
### World service
Serves regions, clusters, books, coordinates, neighbor links, filters.

### Ingestion service
Handles upload processing, OCR / vision orchestration, barcode lookup, CSV parse, canonical matching.

### User modeling service
Builds user taste profile, reading path, chronology stats, shelf clusters.

### Recommendation service
Scores and returns near-path, bridge, frontier, and semantic neighbor recommendations.

### Explanation service
Explains proximity, path connections, and recommendation logic.

---

# Document 3 — Data Model and Database Schema

## 1. Schema design goals
The schema must support:
- canonical book universe
- multiple entity types
- embeddings and structured features
- hierarchical clusters
- multiple graph edge types
- stable 3D coordinates
- user shelves with chronology
- upload jobs and confidence results
- recommendations and explanations

## 2. PostgreSQL schema

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

create table authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_name text,
  bio text,
  nationality text,
  birth_year int,
  death_year int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text,
  popularity_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  slug text unique,
  description text,
  short_description text,
  publication_year int,
  original_publication_year int,
  page_count int,
  language_code text default 'en',
  isbn_10 text,
  isbn_13 text,
  asin text,
  cover_image_url text,
  canonical_genre text,
  age_audience text,
  popularity_score numeric(8,4) not null default 0,
  quality_score numeric(8,4) not null default 0,
  series_id uuid references series(id) on delete set null,
  series_order numeric(8,2),
  primary_author_id uuid references authors(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table book_authors (
  book_id uuid not null references books(id) on delete cascade,
  author_id uuid not null references authors(id) on delete cascade,
  role text not null default 'author',
  ordinal int not null default 1,
  primary key (book_id, author_id, role)
);

create table book_tags (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  tag_type text not null,
  tag_value text not null,
  source text not null,
  weight numeric(8,4) not null default 1,
  created_at timestamptz not null default now()
);

create table book_features (
  book_id uuid primary key references books(id) on delete cascade,
  fantasy_scifi_score numeric(8,4) not null,
  softness_hardness_score numeric(8,4) not null,
  intimacy_epic_score numeric(8,4) not null,
  darkness_coziness_score numeric(8,4) not null,
  literary_plot_score numeric(8,4) not null,
  romance_intensity_score numeric(8,4) not null,
  political_adventure_score numeric(8,4) not null,
  weirdness_score numeric(8,4) not null,
  pacing_score numeric(8,4) not null,
  worldbuilding_density_score numeric(8,4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table book_embeddings (
  book_id uuid primary key references books(id) on delete cascade,
  embedding_model text not null,
  embedding vector(1536) not null,
  embedding_text text,
  created_at timestamptz not null default now()
);

create index book_embeddings_vector_idx on book_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index books_title_trgm_idx on books using gin (title gin_trgm_ops);
create index books_isbn_13_idx on books(isbn_13);
create index books_isbn_10_idx on books(isbn_10);

create table regions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  description text,
  anchor_x numeric(12,6) not null,
  anchor_y numeric(12,6) not null,
  anchor_z numeric(12,6) not null,
  color_hex text,
  icon_name text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table clusters (
  id uuid primary key default gen_random_uuid(),
  parent_cluster_id uuid references clusters(id) on delete set null,
  region_id uuid references regions(id) on delete set null,
  level text not null,
  name text not null,
  description text,
  centroid_x numeric(12,6),
  centroid_y numeric(12,6),
  centroid_z numeric(12,6),
  radius numeric(12,6),
  density_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table book_cluster_membership (
  book_id uuid not null references books(id) on delete cascade,
  cluster_id uuid not null references clusters(id) on delete cascade,
  membership_role text not null default 'member',
  confidence numeric(8,4) not null,
  primary key (book_id, cluster_id)
);

create table book_coordinates (
  book_id uuid primary key references books(id) on delete cascade,
  layout_version text not null,
  region_id uuid references regions(id) on delete set null,
  primary_cluster_id uuid references clusters(id) on delete set null,
  x numeric(12,6) not null,
  y numeric(12,6) not null,
  z numeric(12,6) not null,
  local_radius numeric(12,6),
  stability_score numeric(8,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index book_coordinates_xyz_idx on book_coordinates(x, y, z);

create table book_edges (
  id uuid primary key default gen_random_uuid(),
  source_book_id uuid not null references books(id) on delete cascade,
  target_book_id uuid not null references books(id) on delete cascade,
  edge_type text not null,
  score numeric(8,4) not null,
  rank int,
  explanation jsonb,
  created_at timestamptz not null default now(),
  unique (source_book_id, target_book_id, edge_type)
);

create index book_edges_source_type_idx on book_edges(source_book_id, edge_type);
create index book_edges_target_type_idx on book_edges(target_book_id, edge_type);

create table book_graph_metrics (
  book_id uuid primary key references books(id) on delete cascade,
  bridge_score numeric(8,4) not null default 0,
  centrality_score numeric(8,4) not null default 0,
  outlier_score numeric(8,4) not null default 0,
  series_anchor_score numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key,
  email text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_shelf_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  upload_type text not null,
  source_file_url text,
  status text not null default 'pending',
  raw_payload jsonb,
  processing_notes jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_upload_candidates (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references user_shelf_uploads(id) on delete cascade,
  extracted_title text,
  extracted_author text,
  extracted_isbn text,
  canonical_book_id uuid references books(id) on delete set null,
  confidence numeric(8,4) not null default 0,
  extraction_source text,
  status text not null default 'pending',
  raw_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  source_upload_id uuid references user_shelf_uploads(id) on delete set null,
  ownership_type text not null default 'owned',
  read_status text not null default 'unknown',
  rating numeric(3,1),
  started_at date,
  finished_at date,
  read_at date,
  days_to_read int generated always as (
    case
      when started_at is not null and finished_at is not null then greatest((finished_at - started_at), 0)
      else null
    end
  ) stored,
  chronology_confidence numeric(8,4) not null default 0,
  added_at timestamptz not null default now(),
  unique (user_id, book_id)
);

create table user_taste_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  embedding_centroid vector(1536),
  x numeric(12,6),
  y numeric(12,6),
  z numeric(12,6),
  summary jsonb,
  updated_at timestamptz not null default now()
);

create table user_taste_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text,
  centroid_x numeric(12,6),
  centroid_y numeric(12,6),
  centroid_z numeric(12,6),
  book_count int not null,
  summary jsonb,
  created_at timestamptz not null default now()
);

create table user_taste_cluster_books (
  user_taste_cluster_id uuid not null references user_taste_clusters(id) on delete cascade,
  user_book_id uuid not null references user_books(id) on delete cascade,
  primary key (user_taste_cluster_id, user_book_id)
);

create table user_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  algorithm_type text not null,
  chronology_mode text not null,
  path_json jsonb not null,
  stats_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recommendation_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  recommendation_type text not null,
  score numeric(8,4) not null,
  reasons jsonb,
  generated_at timestamptz not null default now(),
  unique(user_id, book_id, recommendation_type)
);

create table user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  event_type text not null,
  event_payload jsonb,
  created_at timestamptz not null default now()
);
```

## 3. Edge types in MVP
MVP edge types should be selectable in the UI and exposed in APIs:
- semantic_similarity
- theme_overlap
- trope_overlap
- tone_similarity
- series_sequence
- same_author
- user_path_adjacency
- bridge_relation

## 4. Notes on popularity
The schema includes `popularity_score`. It should exist from the beginning even if not strongly surfaced in the UI. It can influence:
- size or prominence
- region density summaries
- recommendation tie-breaking
- seed universe curation

---

# Document 4 — Semantic Modeling and Book Universe Construction

## 1. Dense embedding model
Each book has a dense semantic embedding generated from an enriched text profile.

Recommended input template for embedding text:
- title
- subtitle
- author
- series and number
- short synopsis
- long synopsis
- genre labels
- themes
- tropes
- tone descriptors
- audience descriptors
- style descriptors
- setting descriptors
- comparable books if available
- series summary if available

## 2. Structured feature vector
Each book also gets structured feature scores in normalized numeric form.

The initial 10 features are:
- fantasy_scifi_score
- softness_hardness_score
- intimacy_epic_score
- darkness_coziness_score
- literary_plot_score
- romance_intensity_score
- political_adventure_score
- weirdness_score
- pacing_score
- worldbuilding_density_score

These should be generated using deterministic prompts or classification rules and stored in `book_features`.

## 3. Why both are required
Dense embeddings support latent similarity and nearest-neighbor retrieval.
Structured features support:
- interpretable axes
- stable layout
- filtering
- explanations
- recommendation controls

## 4. Universe curation plan for 5,000 books
The initial universe should contain the most read / best known / most popular sci-fi and fantasy books, balanced across:
- classic fantasy
- epic fantasy
- grimdark
- urban fantasy
- cozy fantasy
- romantasy
- mythic / folkloric fantasy
- hard sci-fi
- space opera
- cyberpunk
- dystopian / post-apocalyptic
- science fantasy
- weird speculative
- first contact
- military sci-fi
- YA speculative crossover

Selection criteria for later curation stage:
- cultural significance
- reader popularity
- review volume
- series representation
- subgenre coverage
- bridge titles between regions

---

# Document 5 — Spatial Model and Region Anchors

## 1. Primary axes
The universe uses these interpretable axes:
- X: Fantasy <-> Sci-Fi
- Y: Soft / lyrical / atmospheric <-> Hard / systems / technical
- Z: Intimate / personal / local stakes <-> Epic / political / cosmic stakes

## 2. Visual encodings beyond XYZ
Additional properties should use visual channels instead of new axes:
- color: darkness <-> coziness or region identity
- size: popularity / significance
- halo: series membership or series anchor
- glow: recommendation status or path presence
- line style: edge type

## 3. Macro-regions
Suggested initial regions and approximate anchors:

| Region | X | Y | Z |
|---|---:|---:|---:|
| Mythic & Folkloric Fantasy | -0.90 | -0.45 | 0.10 |
| Cozy & Heartwarming Fantasy | -0.85 | -0.60 | -0.35 |
| Urban & Contemporary Fantasy | -0.70 | -0.10 | -0.05 |
| Epic & Secondary World Fantasy | -0.80 | 0.10 | 0.80 |
| Grimdark & Dark Political Fantasy | -0.72 | 0.30 | 0.88 |
| Romantasy & Court Fantasy | -0.68 | -0.10 | 0.20 |
| Science Fantasy Borderlands | -0.10 | 0.00 | 0.45 |
| Dystopian & Post-Apocalyptic | 0.35 | 0.05 | 0.35 |
| First Contact & Philosophical SF | 0.55 | 0.20 | 0.40 |
| Space Opera & Galactic Adventure | 0.75 | 0.15 | 0.82 |
| Military SF & Strategy | 0.78 | 0.55 | 0.78 |
| Hard SF & Technical Speculation | 0.90 | 0.82 | 0.52 |
| Cyberpunk & Near Future Tech | 0.82 | 0.58 | -0.05 |
| Weird & Experimental Speculative | 0.10 | -0.20 | 0.18 |

These are seed anchors, not final truth. They are meant to provide stable initial geography.

## 4. Series anchors
Series anchors are first-class spatial objects in sci-fi and fantasy. A series anchor:
- sits at or near the centroid of its books
- acts as a visual parent object
- can be expanded to show individual books orbiting locally
- may serve as a micro hub for navigation

## 5. Final coordinate equation
Each book coordinate should be computed as:

`final_position = region_anchor + cluster_offset + local_book_offset + stability_correction`

Where:
- `region_anchor` is fixed or slowly changing
- `cluster_offset` comes from cluster placement within the region
- `local_book_offset` comes from neighbor-preserving local layout
- `stability_correction` minimizes drift across layout versions

---

# Document 6 — Graph Model, Clustering, and Edge Construction

## 1. Hidden graph as the truth layer
The 3D map is a view. The hidden graph is the core semantic engine.

Nodes:
- books
- optional future support for authors, themes, tropes, and series as graph nodes

Edges in MVP:
- semantic_similarity
- theme_overlap
- trope_overlap
- tone_similarity
- series_sequence
- same_author
- bridge_relation
- user_path_adjacency

## 2. Clustering levels
Use hierarchical clustering levels:
- macro clusters: broad subgenre zones
- meso clusters: reader-appeal groups
- micro clusters: tight local similarity neighborhoods

## 3. Suggested clustering pipeline
1. Compute dense embeddings
2. Build kNN graph
3. Run Leiden or Louvain community detection on semantic graph for meso clusters
4. Run hierarchical agglomeration or HDBSCAN within meso clusters for micro clusters
5. Map clusters to macro regions using region classifier and centroid features

## 4. Bridge score
Bridge books are important for cross-region movement.
A bridge score should combine:
- graph betweenness centrality
- neighbor diversity across regions / clusters
- high semantic connectivity across otherwise distant neighborhoods

Pseudo formula:

`bridge_score = 0.5 * normalized_betweenness + 0.3 * region_diversity + 0.2 * cluster_diversity`

## 5. Multiple edge types for filtering
The client should allow filtering or highlighting by selected edge type. The backend should expose edge type as a parameter wherever neighbor retrieval is needed.

---

# Document 7 — Upload Ingestion and Canonical Matching Design

## 1. Supported inputs
The MVP supports:
- bookshelf photo
- bookshelf video
- barcode camera scan
- CSV upload

## 2. Upload job pipeline
All uploads should use asynchronous job processing.

Stages:
1. upload received
2. upload job record created
3. extraction pipeline selected
4. candidate titles or ISBNs extracted
5. canonical matching performed
6. confidence assigned
7. user confirmation UI presented
8. accepted books stored in `user_books`
9. taste profile and path recomputed

## 3. Bookshelf photo pipeline
1. user uploads image
2. pre-process image for contrast, crop, orientation
3. Claude image extracts visible spines and candidate title/author pairs
4. for each extracted item, fuzzy match to canonical `books`
5. return candidate list with confidence score and evidence snippets
6. user confirms or rejects

## 4. Bookshelf video pipeline
1. user uploads up to ~30 second video
2. backend extracts frames at interval
3. remove near-duplicate frames using perceptual hash or visual similarity threshold
4. send unique frames to Claude image for spine extraction
5. merge candidate detections across frames
6. fuzzy match to canonical books
7. return candidate list with confidence and evidence
8. user confirms or rejects

## 5. Barcode pipeline
1. user opens camera scanner
2. app captures barcode
3. decode ISBN
4. look up canonical book
5. if exact match missing, fall back to metadata lookup
6. user confirms

## 6. CSV pipeline
CSV should support columns such as:
- title
- author
- isbn
- series
- started_at
- finished_at
- read_at
- rating
- read_status

Matching logic:
- exact ISBN if present
- title + author fuzzy match
- series-aware disambiguation
- publication year tie-breakers

## 7. Confidence scoring for extracted candidates
Candidate confidence should combine:
- OCR / vision certainty
- title fuzzy score
- author fuzzy score
- ISBN exactness
- series match
- cover / spine evidence quality if available

Recommended confidence formula:

`confidence = 0.35 * title_match + 0.25 * author_match + 0.25 * isbn_match + 0.10 * series_match + 0.05 * evidence_quality`

## 8. Confirmation UX requirement
No extracted book becomes part of the shelf until user confirmed, unless the confidence exceeds a clearly defined auto-accept threshold and the product later allows auto-accept.

MVP recommendation:
- always show confirmation list
- sort by confidence descending
- allow bulk accept and edit

---

# Document 8 — User Shelf, Chronology, and Path Algorithm

## 1. Key requirement
If chronology is supplied, the user path should respect read order. If chronology is missing, the system should compute a semantic traversal path. If chronology is partial, the system should compute a hybrid path.

The path should also surface time information such as:
- days to read per book where possible
- elapsed time between books
- gaps between reading phases

## 2. Path modes
### Chronology mode
Used when all or most books have dates.
- primary ordering by `started_at`, then `finished_at`, then `read_at`
- ties broken semantically
- path visually progresses through time

### Semantic mode
Used when chronology is absent.
- path derived from semantic structure of user shelf
- should reveal a sensible traversal through taste space

### Hybrid mode
Used when chronology is partial.
- dated books act as anchors
- undated books are inserted into semantically appropriate locations between date anchors

## 3. User taste profile outputs
For each user compute:
- embedding centroid
- spatial centroid
- user shelf clusters
- backbone path(s)
- reading chronology stats
- top regions
- top themes and edge affinities

## 4. Chronological path algorithm
Input: confirmed `user_books` with dates and coordinates.

Algorithm:
1. separate books into dated and undated
2. sort dated books by chronology fields
3. for books with equal or overlapping dates, order by semantic nearest-neighbor continuity
4. compute segment metadata:
   - start date
   - finish date
   - days to read
   - days gap to next book
5. render ordered path through dated books

## 5. Semantic traversal path algorithm
Use when chronology is absent.

Recommended algorithm:
1. fetch all user books with embeddings and coordinates
2. build user-only semantic graph using semantic edge scores
3. compute minimum spanning tree using distance as edge weight
4. identify major branch points and core spine
5. choose root near shelf centroid or most central node
6. extract primary traversal order from backbone using depth-first traversal with branch ranking
7. smooth resulting path in 3D with spline interpolation for rendering

Rationale:
- MST reveals minimal connective structure
- avoids noisy complete graph
- produces a legible, organic shelf pathway

## 6. Hybrid path algorithm
Use when some books have chronology and some do not.

Algorithm:
1. sort dated books chronologically
2. treat dated books as fixed anchors
3. assign each undated book to the closest chronological segment based on semantic similarity and coordinate proximity
4. within each segment, insert undated books using local semantic traversal ordering
5. if a book fits poorly between all anchors, attach it as a side branch to the nearest relevant anchor or cluster
6. generate final ordered path plus optional side branches

## 7. Path statistics
Each generated path should include:
- total books on path
- number with chronology
- chronology coverage ratio
- average days to read
- average days between reads
- longest pause
- path span in days
- number of clusters touched
- number of regions touched

## 8. Path data structure
Suggested `path_json` structure:

```json
{
  "nodes": [
    {
      "user_book_id": "uuid",
      "book_id": "uuid",
      "order_index": 1,
      "branch_id": "main",
      "x": -0.12,
      "y": 0.33,
      "z": 0.71,
      "started_at": "2024-01-05",
      "finished_at": "2024-01-12",
      "days_to_read": 7,
      "days_gap_to_next": 3,
      "chronology_confidence": 1.0,
      "semantic_confidence": 0.88
    }
  ],
  "edges": [
    {
      "from_user_book_id": "uuid",
      "to_user_book_id": "uuid",
      "edge_kind": "chronological",
      "weight": 0.91,
      "branch_id": "main"
    }
  ],
  "splines": [
    {
      "branch_id": "main",
      "control_points": [
        [-0.1, 0.3, 0.7],
        [0.0, 0.4, 0.6]
      ]
    }
  ]
}
```

## 9. Recommendation tray behavior
The bottom recommendation tray should understand the user path and support moving the camera or focus through space.

Modes:
- near your path
- bridge outward
- frontier exploration
- similar to current selected node
- continue your reading arc

When the user chooses a recommendation, the client should animate travel or focus toward that point in the world.

---

# Document 9 — Recommendation and Explanation Engine

## 1. Recommendation types
The MVP should support:
- near_path
- bridge_outward
- frontier
- local_neighbors
- series_completion
- adjacent_region

## 2. Recommendation scoring
Suggested general score:

`score = a * user_book_similarity + b * path_proximity + c * bridge_score + d * popularity_score + e * quality_score - f * ownership_penalty`

Different recommendation types use different weights.

### near_path
High path proximity, high semantic similarity.

### bridge_outward
Moderate path proximity, high bridge score, some novelty.

### frontier
Moderate similarity, high novelty, bounded distance from shelf centroid.

### series_completion
High series relation if user owns or read adjacent volumes.

## 3. Explanation generation
Every recommendation should include structured reasons such as:
- close to your recent reading path
- bridges your grimdark and political fantasy clusters
- similar tone to X, larger scope than Y
- close to your shelf cluster in space opera
- likely next step from your path through first-contact books

The explanation service should rely on:
- shared edge types
- path adjacency
- cluster memberships
- structured feature comparisons
- region transitions

---

# Document 10 — API Design

## 1. API principles
- REST first for MVP
- stable typed response shapes
- support filtering by region, cluster, edge_type, recommendation_type
- support pagination and chunked world retrieval
- allow progressive detail for 3D rendering

## 2. World APIs
### GET /api/world/regions
Returns all macro regions.

Response:
```json
{
  "regions": [
    {
      "id": "uuid",
      "name": "Epic & Secondary World Fantasy",
      "slug": "epic-secondary-world-fantasy",
      "anchor": {"x": -0.80, "y": 0.10, "z": 0.80},
      "color_hex": "#7D5BA6",
      "book_count": 523
    }
  ]
}
```

### GET /api/world/clusters?region_id=<uuid>&level=meso
Returns clusters for a region and level.

### GET /api/world/books/near?x=<n>&y=<n>&z=<n>&radius=<n>&edge_type=semantic_similarity
Returns nearby books for local world rendering.

### GET /api/world/books/{book_id}
Returns book details, coordinates, region, cluster, features, and graph metrics.

### GET /api/world/books/{book_id}/neighbors?edge_type=semantic_similarity&limit=20
Returns neighbors for selected edge type.

### GET /api/world/series/{series_id}
Returns series anchor and child books.

## 3. Search and matching APIs
### GET /api/search/books?q=<query>
Fuzzy search books.

### POST /api/match/books
Request body:
```json
{
  "items": [
    {"title": "Dune", "author": "Frank Herbert"}
  ]
}
```

Response returns canonical matches with confidence.

## 4. Upload APIs
### POST /api/uploads/photo
Creates bookshelf photo upload job.

### POST /api/uploads/video
Creates bookshelf video upload job.

### POST /api/uploads/barcode
Accepts decoded barcode or image.

### POST /api/uploads/csv
Creates CSV parse job.

### GET /api/uploads/{upload_id}
Returns job status.

### GET /api/uploads/{upload_id}/candidates
Returns extracted candidates with confidence.

### POST /api/uploads/{upload_id}/confirm
Request body:
```json
{
  "accepted": [
    {
      "candidate_id": "uuid",
      "book_id": "uuid",
      "started_at": "2024-01-01",
      "finished_at": "2024-01-10",
      "rating": 4.5,
      "read_status": "read"
    }
  ],
  "rejected": ["uuid"]
}
```

## 5. User shelf and profile APIs
### GET /api/me/shelf
Returns user shelf books.

### POST /api/me/shelf/books
Add or edit shelf books manually.

### DELETE /api/me/shelf/books/{book_id}
Remove shelf book.

### GET /api/me/profile/taste
Returns centroid, top clusters, top regions, summary.

### GET /api/me/profile/path
Returns current path JSON.

### POST /api/me/profile/path/recompute
Recomputes path.

## 6. Recommendation APIs
### GET /api/me/recommendations?type=near_path&limit=20
Returns recommendations.

### GET /api/me/recommendations/{book_id}/why
Returns recommendation explanation.

## 7. Explanation APIs
### GET /api/world/books/{book_id}/why-near/{other_book_id}
Explains proximity.

### GET /api/me/path/segments
Returns structured path segment metadata.

---

# Document 11 — Frontend and Interaction Design Notes

## 1. Core view structure
- persistent universe scene as primary canvas
- side rail / drawer for upload and controls
- bottom recommendation tray
- details panel for selected book / series / cluster

## 2. Rendering priorities
At far zoom:
- regions
- major clusters
- series anchors

At mid zoom:
- series anchor labels
- important books
- cluster boundaries

At near zoom:
- individual books
- selected edges
- path glow
- recommendation highlights

## 3. Path visualization
- main branch as bright glowing spline
- chronology segments optionally color-shift by time
- side branches thinner and less bright
- selected book pulses on path
- reading duration may affect node halo size or animation timing

## 4. User controls
- toggle my shelf
- toggle my path
- filter edge types
- show recommendations by mode
- filter by subgenre / region / tone
- reset to universe

## 5. Recommendation interaction
Selecting a recommendation from the bottom tray should:
- highlight the recommendation in-world
- animate camera travel toward it
- reveal surrounding local cluster
- explain why it was selected

---

# Document 12 — Seed Data and Build Assets Required for Claude

## 1. Seed assets to provide later
Claude should receive:
- this technical design packet
- SQL schema
- seed region definitions
- sample 500 to 5,000 book dataset schema
- sample API response payloads
- a few sample user shelves
- sample upload candidate payloads
- sample path JSON outputs

## 2. Dummy data requirements
Need sample records for:
- 20 to 50 regions / clusters / books for local development
- 3 to 5 series with multiple volumes
- 3 user accounts
- example uploads for photo, video, barcode, CSV
- example path outputs for chronology, semantic, and hybrid modes

---

# Document 13 — Implementation Roadmap

## Phase 0 — Foundation
Deliverables:
- repository structure
- environment config
- Supabase project wiring
- Clerk or auth integration decision
- core backend and frontend scaffolding

## Phase 1 — Canonical universe schema and local seed data
Deliverables:
- tables created
- migration tooling
- region seeds
- cluster seeds
- sample books and series
- search working locally

## Phase 2 — Semantic world engine
Deliverables:
- embedding generation pipeline
- feature generation pipeline
- graph edge builder
- cluster builder
- coordinate generator
- layout export and persistence

## Phase 3 — World APIs and 3D viewer
Deliverables:
- region and world APIs
- local neighborhood queries
- book detail APIs
- React Three Fiber universe scene
- zoom / select / inspect interactions

## Phase 4 — Upload and matching system
Deliverables:
- photo upload pipeline
- video frame extraction and dedupe
- barcode scan ingestion
- CSV parser
- candidate confirmation workflow

## Phase 5 — User shelf and path engine
Deliverables:
- user shelf CRUD
- taste profile calculation
- chronology path algorithm
- semantic traversal path algorithm
- hybrid path algorithm
- path overlay rendering

## Phase 6 — Recommendation engine and explanation layer
Deliverables:
- near-path, bridge, frontier recommendations
- explanation endpoints
- bottom tray and in-world navigation

## Phase 7 — Polish and observability
Deliverables:
- analytics events
- error handling
- caching and performance work
- layout versioning
- recommendation tuning

## Phase 8 — Expansion
Future work:
- live avatar movement
- collaborative maps
- richer author / theme / trope nodes
- broader fiction domains
- cross-user recommendation patterns

---

# Document 14 — Pseudocode Appendix

## 1. Coordinate generation pseudocode
```python
for book in books:
    features = feature_map[book.id]
    embedding = embedding_map[book.id]
    region = assign_region(features, embedding)
    cluster = assign_cluster(book, region)
    region_anchor = get_region_anchor(region)
    cluster_offset = compute_cluster_offset(cluster, region)
    local_offset = compute_local_neighbor_layout(book, cluster)
    stability_correction = get_stability_correction(book, prior_layout)
    final_xyz = region_anchor + cluster_offset + local_offset + stability_correction
    save_coordinate(book.id, final_xyz)
```

## 2. Semantic traversal pseudocode
```python
def build_semantic_path(user_books):
    graph = build_user_semantic_graph(user_books)
    mst = minimum_spanning_tree(graph, weight="semantic_distance")
    root = select_root_node(user_books)
    ordered_nodes = depth_first_backbone_traversal(mst, root)
    splines = smooth_path_to_splines(ordered_nodes)
    return ordered_nodes, splines
```

## 3. Hybrid path pseudocode
```python
def build_hybrid_path(user_books):
    dated = [b for b in user_books if b.has_any_date()]
    undated = [b for b in user_books if not b.has_any_date()]

    dated = sort_chronologically(dated)
    segments = make_segments_between_dated_books(dated)

    for book in undated:
        segment = assign_best_segment(book, segments)
        segment.undated_books.append(book)

    final_order = []
    for segment in segments:
        local_order = semantic_order(segment.undated_books, segment.start_anchor, segment.end_anchor)
        final_order.extend([segment.start_anchor, *local_order])
    final_order.append(segments[-1].end_anchor)

    splines = smooth_path_to_splines(final_order)
    return final_order, splines
```

## 4. Recommendation pseudocode
```python
def score_recommendation(candidate, user_profile, path, owned_book_ids, mode):
    sim = similarity_to_user_books(candidate, user_profile)
    path_score = proximity_to_path(candidate, path)
    bridge = candidate.bridge_score
    popularity = candidate.popularity_score
    quality = candidate.quality_score
    owned_penalty = 1.0 if candidate.id in owned_book_ids else 0.0

    weights = get_mode_weights(mode)
    return (
        weights.a * sim +
        weights.b * path_score +
        weights.c * bridge +
        weights.d * popularity +
        weights.e * quality -
        weights.f * owned_penalty
    )
```

---

# Document 15 — Build Guidance for Claude

## 1. Build sequence
Claude should not attempt to build the entire product in one pass.

Recommended order:
1. database schema and migrations
2. seed regions, clusters, and sample books
3. backend models and API contracts
4. semantic pipelines and layout engine
5. 3D viewer against static data
6. upload and matching pipelines
7. user path engine
8. recommendations and explanations

## 2. Code quality requirements
- modular code
- versioned migrations
- typed API payloads
- separable pipeline jobs
- environment-based configuration
- idempotent seed scripts
- clear test fixtures

## 3. Non-goals for first build pass
- live multiplayer movement
- full mobile parity
- all genres beyond sci-fi and fantasy
- perfect OCR automation without user confirmation

---

# Final Notes
This packet is the source of truth for the MVP build. Subsequent documents should add:
1. curated 5,000-book universe seed specification
2. actual sample seed data
3. region and cluster seed files
4. OpenAPI schema or typed contracts
5. implementation tasks by sprint

