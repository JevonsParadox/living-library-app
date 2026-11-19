# Schema

## Overview

The data model is a typed, weighted graph organised around **conceptual clusters**, not ownership or authorship. Subjects are the primary visual structure. Books sit within subject clusters. Authors, status, and other metadata are secondary — visible on interaction, not by default.

### Graph hierarchy in the schema

| Level | Table | Visual role |
|---|---|---|
| 1 — Macro clusters | Derived (Fiction/Non-fiction) | Two zones, not stored |
| 2 — Subject clusters | `subjects` | Hub nodes, primary structure |
| 2 — Theme clusters | `themes` | Alternate grouping mode |
| 3 — Books | `books` | Content nodes within clusters |
| 4 — Metadata | `authors`, future `sellers`/`listings` | Hidden until interaction |

### Key edges for the constellation

| Edge | Purpose |
|---|---|
| `belongs_to` (book → subject) | Places book in a cluster — this is the backbone |
| `linked_to` (book → theme) | Alternate clustering |
| `owns/reading/read/wishlist` (user → book) | Determines which books appear + status |
| `wrote` (author → book) | Metadata, not visual structure |

---

## V1 — Active

### books
Global book metadata. One row per unique book.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| isbn | text | Unique, nullable |
| title | text | Required |
| author | text | Required (denormalised, kept for display) |
| cover_url | text | URL to cover image |
| publisher | text | |
| published_year | smallint | |
| page_count | smallint | |
| description | text | |
| created_at | timestamptz | Auto-set |

### authors
Author as a distinct node, separate from book metadata.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Required, unique |
| bio | text | Nullable |
| created_at | timestamptz | Auto-set |

### edges
Generic relationship table. All connections between nodes in the graph.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| source_type | text | Node type: 'user', 'book', 'author' |
| source_id | text | UUID or Clerk user ID |
| target_type | text | Node type |
| target_id | text | UUID or Clerk user ID |
| edge_type | text | 'owns', 'read', 'reading', 'wishlist', 'wrote' |
| weight | float | 0.0–1.0, default 1.0 |
| metadata | jsonb | Type-specific data (rating, notes, etc.) |
| created_at | timestamptz | Auto-set |

**Indexes:**
- `(source_type, source_id)` — "all edges from this node"
- `(target_type, target_id)` — "all edges to this node"
- `(edge_type)` — filter by relationship type
- `(source_type, source_id, edge_type)` — "all books this user owns"

**Unique constraint:** `(source_type, source_id, target_type, target_id, edge_type)` — prevents duplicate edges.

### V1 Edge Types

| Edge | Source → Target | Metadata |
|---|---|---|
| owns | user → book | `{ "rating": N, "notes": "..." }` |
| reading | user → book | `{ "notes": "..." }` |
| read | user → book | `{ "rating": N, "notes": "..." }` |
| wishlist | user → book | |
| wrote | author → book | |

### user_books (legacy)
Retained during migration. Will be deprecated once all queries use edges.

---

## V1 RLS Policies

| Table | Operation | Rule |
|---|---|---|
| books | SELECT | Any authenticated user |
| books | INSERT | Any authenticated user |
| authors | SELECT | Any authenticated user |
| authors | INSERT | Any authenticated user |
| edges | SELECT | User-sourced edges: `source_id = jwt.sub`. System edges (e.g. `wrote`): all authenticated users |
| edges | INSERT | User-sourced edges only (`source_id = jwt.sub`) |
| edges | UPDATE | User-sourced edges only |
| edges | DELETE | User-sourced edges only |

---

## Migration Path

### From user_books to edges

| user_books | edges |
|---|---|
| `status = 'unread'` | edge_type `owns` |
| `status = 'reading'` | edge_type `reading` |
| `status = 'read'` | edge_type `read` |
| `status = 'wishlist'` | edge_type `wishlist` |
| `rating` | metadata `{ "rating": N }` |
| `notes` | metadata `{ "notes": "..." }` |

### From books.author to wrote edges

Each unique `books.author` value becomes an `authors` row, with a `wrote` edge connecting author → book.

---

## V2 — Active

### subjects
Broad categories. 30 seeded (Fiction, Science, History, etc.)

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Required, unique |
| created_at | timestamptz | Auto-set |

### themes
Specific ideas or threads. 20 seeded (dystopia, identity, consciousness, etc.)

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Required, unique |
| description | text | Nullable |
| created_at | timestamptz | Auto-set |

### V2 Edge Types

| Edge | Source → Target | Notes |
|---|---|---|
| belongs_to | book → subject | 1-3 subjects per book |
| linked_to | book → theme | 1-2 themes per book |

### Planned Next

| Addition | Purpose |
|---|---|
| Filter by subject/theme in Library | Graph-powered filtering |
| Subject/theme nodes in constellation | Visual clustering |
| Basic recommendations | "Same author" and "popular with others" queries |

---

## Future — V3+

| Addition | Purpose |
|---|---|
| `clusters` table | Groupings of related nodes |
| `arcs` table | Reading journeys/sequences |
| `similar_to` edges (book↔book, user↔user) | Embedding-based similarity via Pinecone |
| Visual constellation UI | Interactive graph rendering |
| `sellers` table | Secondhand sellers/shops |
| `listings` table | Specific book availability (price, condition) |
| `offers` edges (seller → listing) | Seller inventory |
| `available_for` edges (listing → book) | Marketplace overlay on graph |

Seller/listing nodes and edges are part of the conceptual architecture now. They will connect to the same `edges` table with no schema changes when implemented.

---

## Design Decisions

- **Domain tables for nodes, generic table for edges** — gives type safety on nodes and flexibility on relationships
- **source_id and target_id are text, not uuid** — Clerk user IDs are strings, so all IDs are stored as text for consistency
- **books.author text field retained** — denormalised for display. The `wrote` edge is the canonical relationship
- **weight defaults to 1.0** — only matters for ranked queries (recommendations, similarity). V1 edges are unweighted in practice
- **metadata is jsonb** — flexible per-edge-type data without schema changes

## JWT Integration (Clerk → Supabase)

Supabase doesn't use its own auth — it trusts Clerk-issued JWTs.

**How it works:**
1. Clerk issues a JWT using a custom "supabase" template (configured in Clerk dashboard)
2. The JWT contains the user's `sub` claim (Clerk user ID)
3. Our Supabase clients pass this JWT in the `Authorization` header
4. Supabase RLS policies read `auth.jwt() ->> 'sub'` to identify the user

**Client usage:**
- `lib/supabase.ts` — `createClient()` for anonymous queries, `createAuthClient(token)` for authenticated browser queries
- `lib/supabase-server.ts` — `createClient()` for anonymous queries, `createAuthClient()` for authenticated server queries

## Migrations

- `00001_create_books_and_user_books.sql` — V1 tables (books, user_books)
- `00002_allow_authenticated_insert_books.sql` — INSERT policy for books
- `00003_create_edges_and_authors.sql` — edges table, authors table, indexes, RLS, migrate user_books and books.author data
- `00004_allow_wrote_edge_insert.sql` — RLS policy for wrote edge inserts
- `00005_create_subjects_and_themes.sql` — subjects/themes tables, RLS, updated edge policies for belongs_to/linked_to
