# Site Map

## Architecture: Universe + Overlays

The graph is the persistent background. Tabs control overlays and what's visible in the universe. The graph never unmounts.

```
┌─────────────────────────────────────┐
│  Tab overlay (filters, search,      │  Semi-transparent, changes per tab
│  stats — floats above universe)     │
├─────────────────────────────────────┤
│                                     │
│         UNIVERSE (full screen)      │  Persistent react-force-graph
│         Deep space background       │  Always rendered
│         Star nodes, constellation   │
│                                     │
├─────────────────────────────────────┤
│  Detail panel (slides up on tap)    │  Book/cluster info
├─────────────────────────────────────┤
│  ▫ Home  ▫ Library  ▫ Discover ...  │  Tab bar
└─────────────────────────────────────┘
```

---

## Tabs as Lenses

### Home (`/home`)
Default view of your universe. Zoomed out to show all clusters.

**Overlay:** Reading stats summary (books read, reading, wishlist), gap detection hints
**Universe state:** Full constellation visible, no filters, no expansion

---

### Library (`/library`)
Your universe with active filters.

**Overlay:** Status pills, subject/theme toggle, author dropdown, subject/theme dropdowns
**Universe state:** Filters reshape which stars are visible. Tap cluster to expand. Tap star for detail.

---

### Discover (`/discover`)
Your universe expanded with books you don't own.

**Overlay:** Search bar. Results appear as new dim stars in the universe.
**Universe state:** Your books = bright stars. Search results / unowned books = dim, faint stars. Tap to see details and add to library.

---

### World (`/world`)
Multiple universes visible.

**Overlay:** Location, community info
**Universe state:** Your constellation + other users' constellations as distant galaxies. Shared books bridge between galaxies. Cluster-level exploration.

---

### Profile (`/profile`)
Your universe with identity overlay.

**Overlay:** Reading stats, cluster density chart, reading shape summary, account management
**Universe state:** Same as Home but with identity-focused data overlay.

---

## Non-Tab Pages

- `/sign-in` — Clerk sign-in (standard page, not universe)
- `/sign-up` — Clerk sign-up (standard page, not universe)
- `/book/[id]` — Book detail (may become a deep-link that focuses the universe on that star)

---

## Interaction Model

### Zoom levels
| Level | What's visible |
|---|---|
| Galaxy view (zoomed out) | Cluster nebulae only, labels visible |
| Constellation view (mid) | Books appear as small stars within clusters |
| Star system view (zoomed in) | Book labels visible, detail on hover |

### Node interaction
- **Hover**: node brightens, neighbourhood highlights, everything else fades to 10-20%
- **Tap/click**: lock focus, camera centres smoothly, detail panel slides up
- **Background tap**: release focus, full visibility restores

### Tab transitions
Switching tabs does not reload the graph. It adjusts:
- Which stars are visible (filters)
- What overlays appear (search, stats, filters)
- Camera position (optional smooth transition)
