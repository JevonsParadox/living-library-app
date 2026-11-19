# Product Requirements — Personal Knowledge Constellation

## Overview

The core experience is a personal knowledge constellation: a graph of ideas organised around conceptual clusters, not ownership or authorship. The graph reveals intellectual identity, reading density, and discovery paths.

---

## Graph Hierarchy

### Level 1 — Macro Clusters
| Cluster | Contains |
|---|---|
| Fiction | Fantasy, Sci-fi, Horror, Thriller, Romance, Adventure, Young Adult, Classic Literature, Literary Fiction, Mystery, Fiction |
| Non-fiction | Everything else: Philosophy, History, Science, Psychology, Economics, etc. |

Macro clusters are derived — a frontend mapping from subject name to fiction/non-fiction. Not stored in the database.

### Level 2 — Subject Clusters (primary visual structure)
The main gravity wells. Each subject is a hub node, sized by the number of books it contains. Examples: Philosophy, Sci-fi, History, Economics, Psychology, Fantasy, Theology, Systems Thinking.

Alternate grouping: **Theme clusters** (dystopia, identity, consciousness). Same level, toggled by the user.

### Level 3 — Books
Individual works positioned within clusters. A book can belong to multiple clusters, creating bridge connections. Books are hidden by default and revealed on cluster expand or zoom.

### Level 4 — Metadata (hidden by default)
| Type | Attached to | Visibility |
|---|---|---|
| Author | Book | Shown in book detail panel |
| Notes / highlights | Book | Shown in book detail panel |
| Status (owns/reading/read/wishlist) | Book | Expressed as colour on book dot |
| Rating | Book | Shown in book detail panel |
| Seller / listing | Book | Future overlay, activated by filter |
| Similar users | Cluster | Future, World view only |

---

## Node Visibility Rules

| Element | Default (zoomed out) | Cluster expanded | Book selected |
|---|---|---|---|
| Macro cluster zones | Visible | Visible | Visible |
| Subject hub nodes | Visible, sized by count | Expanded hub shows books | Dimmed except selected |
| Theme hub nodes | Visible when theme mode | Same | Same |
| Books | Hidden (count in hub) | Visible as dots | Selected highlighted |
| Bridge links (hub↔hub) | Visible | Visible | Dimmed |
| Authors | Hidden | Hidden | In detail panel |
| Sellers / listings | Hidden | Hidden | Future: on toggle |

---

## Default Library Experience

### Zoomed out (on load)
- Two macro zones: Fiction (left), Non-fiction (right)
- 5–10 subject hubs per zone, sized by book count
- Hub labels: "Philosophy (12)", "Sci-fi (8)"
- Bridge links between hubs sharing books
- No individual books visible

### Cluster expanded (on tap)
- Hub reveals its books as small coloured dots
- Book colour = status (amber=owned, gold=reading, green=read, blue=wishlist)
- Other clusters dim but remain visible
- Bridge books (multi-cluster) sit between hubs with links to each

### Book selected (on tap)
- Detail panel: title, author, status badge, cluster membership
- Link to book detail page (`/book/[id]`)

### Zoom out
- Books collapse back to cluster counts

---

## Filtering (V1)

Filters reshape the graph — they change which books are included, which changes cluster sizes and bridges.

| Filter | Effect |
|---|---|
| Fiction / Non-fiction toggle | Show only one macro zone |
| Subject dropdown | Expand that subject, dim others |
| Theme mode toggle | Switch grouping from subjects to themes |
| Status pills (owns/reading/read/wishlist) | Include only books with that status |
| Author dropdown | Include only books by that author — shows which clusters they span |

Filters combine: "Fiction + Reading" shows only Fiction-cluster books being read.

Filters reshape, they don't replace. The graph structure remains visible — clusters just resize.

---

## Role of Authors

Authors exist in the data model and support:
- Filtering ("show books by this author")
- Book detail metadata
- Future: author nodes in World view

Authors do **not**:
- Appear as visible nodes in the default constellation
- Serve as the primary clustering mechanism
- Compete visually with subject/theme clusters

---

## Role of Sellers / Listings

Seller and listing nodes are part of the conceptual graph model:
- `sellers` table (future) — name, location
- `listings` table (future) — price, condition
- `offers` edges (seller → listing)
- `available_for` edges (listing → book)

They are:
- **Not visible** in the default constellation
- Activated via a filter or toggle
- Attached to books, not to clusters
- Part of the Library and World views, not the primary structure

---

## Library vs World

### Library
- Personal knowledge constellation
- Shows only the user's books
- Organised by the user's cluster density
- Identity-focused: "this is who I am as a reader"

### World
- Community constellation
- Shows clusters across all users
- Similar readers, shared clusters, demand signals
- Discovery-focused: "this is what's out there"

These are distinct views on distinct data.

---

## Prioritisation

### V1 — Cluster-first constellation ✓ COMPLETE
- Subject hubs as primary visual structure
- Fiction/Non-fiction macro zones
- Expand cluster to see books (pinned circles)
- Status colouring on books
- Filters: status, subject, Fiction/Non-fiction
- Right-side detail panel with book info
- Deep space aesthetic, dark theme throughout

### V1.5 — Book Capture System ✓ COMPLETE
Four capture methods, shared ingestion pipeline, auto subject+theme assignment.

### V2 — Theme mode, bridges, recommendations, reading path ✓ COMPLETE
- Tab consolidation: Home+Library+Discover → single Universe tab (3 tabs total)
- Theme keyword mapping + auto-assignment during ingestion
- Subject/Theme toggle in graph view
- Enhanced bridge visuals: amber glow, dual rings, bridge count on hubs
- Gap/frontier detection: top 3 frontier subjects as tappable filter chips
- Recommendations: 3+ per book via Open Library, ghost star rendering (indigo, dashed, pulsing), orbit around selected book, "Add to library" action
- Reading path: full-library view (all clusters expand), golden book-to-book trail in chronological order, clickable list panel with days between reads
- Auto-seed: covers, recs, read dates enriched on first mount
- Hub spacing tuned via d3 force config

### V3 — Discovery and community (NEXT)
- Zoom-level behaviour (galaxy → constellation → star system)
- World view with community clusters
- "Readers like you" via similar_to edges
- Pinecone for similarity (if needed)

### V4 — Marketplace overlay
- Seller/listing nodes as toggleable layer
- Price and availability on book detail
- Local demand signals in World view
