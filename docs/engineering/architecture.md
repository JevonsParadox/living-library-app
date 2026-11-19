# Architecture

## Overview

Living Library is a universe-first web app. The entire interface is a persistent deep-space constellation rendered with react-force-graph-2d. Tabs are lenses on the same universe — they control overlays and visibility, not separate pages.

---

## System Layers

```
┌─────────────────────────────────┐
│  UniverseView (persistent)      │  Full-screen graph, always mounted
│  + Tab overlays                 │  Filters, search, stats float above
├─────────────────────────────────┤
│  Next.js (App Router)           │  Routing, server components, data
├─────────────────────────────────┤
│  Clerk                          │  Auth — JWT issued per session
├─────────────────────────────────┤
│  Supabase (Postgres + RLS)      │  Data — books, subjects, themes, edges
├─────────────────────────────────┤
│  Pinecone (future, if needed)   │  Embeddings — similarity edges
└─────────────────────────────────┘
```

---

## Universe Rendering

### Architecture pattern

```
(tabs)/layout.tsx
  ├── UniverseProvider (React context — shared state + filters)
  ├── UniverseView (client component — persistent graph + side panel)
  ├── {children} (tab overlays — thin, glass-morphism panels)
  └── BottomNav (floating over dark background)
```

The graph is rendered once in the layout and never unmounts. Tab pages are thin overlay components that read/write universe context. Detail is shown in a right-side slide panel inside UniverseView.

### Universe context

```typescript
interface UniverseState {
  mode: "universe" | "world" | "profile";
  subjectClusters: ClusterData[];
  themeClusters: ClusterData[];
  stats: UniverseStats;
  readingPath: ReadingPathNode[];
  recMap: Record<string, string[]>;
  recTitles: Record<string, string>;
  showReadingPath: boolean;
  showRecommendations: boolean;
  groupMode: "subject" | "theme";
  filters: { status, clusterId, macro };
  expandedClusterId: string | null;
  selectedNodeId: string | null;
}
```

### Graph hierarchy

```
Level 1 — Macro Suns (Fiction / Non-fiction)
  Level 2 — Subject Hubs (cool blue-grey, orbit macro suns)
    Level 3 — Books (pinned in fixed circles when expanded)
      Level 4 — Metadata (right-side panel, fetched on demand)
```

### Visual design

- **Background:** #05070A with 300 twinkling starfield dots
- **Macro suns:** Large warm gradient (gold/amber), always labelled
- **Subject hubs:** Cool blue-grey (#8B9DC3), sized by book count
- **Books:** Tiny twinkling stars, status-coloured (owned/reading/read/wishlist)
- **Edges:** Orbit links (macro→subject, warm), bridge links (subject↔subject, faint), member links (subject→book, very faint)
- **Glow:** Pre-rendered on offscreen canvases for performance

### Interaction model

| Action | Result |
|---|---|
| Click subject hub | Expands: books appear in fixed circle, labels visible, camera zooms in |
| Click book | Right-side panel slides in (cover, title, author, rating, metadata) |
| Click background | Steps back one level: close panel → collapse cluster |
| Click different hub | Smooth switch: collapse old → settle → expand new |
| Click expanded hub | Shows hub info in side panel (book list, bridges) |
| Click macro sun | Shows macro info in side panel (subject breakdown) |
| Hover node | Neighbourhood highlight (connected nodes bright, rest dim) |

### Expanded state behaviour

- Book nodes pinned with `fx`/`fy` in concentric rings (no simulation jitter)
- Hub pinned at centre
- All book labels always visible
- Non-expanded hubs dimmed to ~6% opacity
- Background click collapses back to top level
- On collapse: pins removed, simulation reheated for gentle drift

### Zoom levels

| Level | Visible | Labels |
|---|---|---|
| Galaxy (zoomed out) | Macro suns + subject hubs | Hub names + counts |
| Constellation (mid) | Same | Same |
| Star system (zoomed in) | Star details | Book titles on hover |

### Macro cluster derivation

Frontend constant mapping subject name → Fiction / Non-fiction:
```
Fiction: Fiction, Fantasy, Science Fiction, Horror, Thriller, Romance,
  Adventure, Young Adult, Classic Literature, Mystery
Non-fiction: everything else
```

---

## Graph Storage Strategy

### Approach: Domain tables + generic edges

Node types have their own tables (strong typing). All relationships are in a single `edges` table (flexibility).

### Node storage (existing tables)

| Table | Role in constellation |
|---|---|
| `books` | Level 3 nodes — positioned within clusters |
| `subjects` | Level 2 cluster hubs |
| `themes` | Level 2 hubs (alternate grouping) |
| `authors` | Level 4 metadata — not visual by default |
| `sellers` (future) | Level 4 overlay |
| `listings` (future) | Level 4 overlay |

### Edge storage

One `edges` table for all relationships:

```
edges
  id          uuid
  source_type text
  source_id   text
  target_type text
  target_id   text
  edge_type   text
  weight      float
  metadata    jsonb
  created_at  timestamptz
```

### Key edges for constellation

| Edge | Purpose in constellation |
|---|---|
| `belongs_to` (book → subject) | Places book within a cluster hub |
| `linked_to` (book → theme) | Places book in theme grouping |
| `owns/reading/read/wishlist` (user → book) | Determines which books appear + status colour |
| `wrote` (author → book) | Metadata for detail panel |

### Bridge detection

A bridge book has `belongs_to` edges to 2+ subjects. Query:
```sql
SELECT source_id, count(distinct target_id) as cluster_count
FROM edges
WHERE edge_type = 'belongs_to' AND source_type = 'book'
GROUP BY source_id
HAVING count(distinct target_id) > 1
```

Bridge links between hubs are derived: if any book belongs to both Subject A and Subject B, those hubs are bridged.

---

## Query Patterns

### "Show my constellation" (default view)

```sql
-- Step 1: Get user's book IDs
SELECT target_id FROM edges
WHERE source_type = 'user' AND source_id = :user_id
AND edge_type IN ('owns', 'reading', 'read', 'wishlist')

-- Step 2: Get subject memberships for those books
SELECT source_id as book_id, target_id as subject_id
FROM edges
WHERE source_type = 'book' AND target_type = 'subject'
AND edge_type = 'belongs_to'
AND source_id IN (:book_ids)

-- Step 3: Get subject names
SELECT id, name FROM subjects WHERE id IN (:subject_ids)

-- Frontend: group subjects into fiction/non-fiction, count books per subject, detect bridges
```

### "Expand a cluster"

```sql
-- Get books in this subject
SELECT b.* FROM edges e
JOIN books b ON b.id::text = e.source_id
WHERE e.target_id = :subject_id
AND e.edge_type = 'belongs_to'
AND e.source_id IN (:user_book_ids)
```

### "Filter by status"

Add `AND edge_type = :status` to the Step 1 query. Everything downstream recalculates.

---

## RLS Strategy

- `books`, `subjects`, `themes`, `authors` — SELECT for all authenticated users
- `edges` — users can read/write their own edges (source_id = jwt.sub) + read system edges (wrote, belongs_to, linked_to)
- Seller/listing data (future) — public read, admin write

---

## Future Considerations

- **Pinecone**: Compute `similar_to` edges from book embeddings. Write results back to `edges` table. Constellation shows similarity as proximity.
- **World view**: Same graph structure but across all users. Community clusters, shared reading patterns, demand signals.
- **Performance**: The default view renders only hub nodes (5–30). Books are loaded on demand per cluster. This scales to thousands of books without rendering them all.
- **Graph library**: `react-force-graph-2d` for rendering. D3 force simulation handles positioning. Custom canvas painting for node/link appearance.
