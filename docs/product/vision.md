# Vision

## Core Concept

Living Library transforms a user's physical bookshelf into a navigable universe of ideas — a deep-space constellation where clusters of books, themes, and intellectual territory float in an immersive void.

A library is not a static shelf. It is a living universe of ideas, and you are flying through it.

## What It Feels Like

- Opening the app feels like entering space
- Your books are stars. Your subjects are nebulae. Your reading identity is the shape of your galaxy.
- The experience is atmospheric, calm, and immersive
- Discovery feels like exploration — zooming into a cluster, finding a bridge to an unexpected territory
- It does not feel like a diagram, a dashboard, or a tool

## What It Is

The universe is a **map of what you think about**, expressed through what you read. It reveals:
- Clusters of ideas you return to (bright, dense star systems)
- Density of reading in specific areas (large, glowing nebulae)
- Bridges between intellectual territories (constellation lines between clusters)
- Gaps and frontiers you haven't explored (dark space between your clusters)
- Your identity as a reader — visible in the shape of your universe

## What It Is Not

- Not a list of books
- Not an author directory
- Not a marketplace
- Not a network diagram or data visualisation tool
- Not a gamified reading tracker

## The Universe Is the App

The graph is not a widget on a page — it IS the app. Every interaction happens within the universe:
- Filtering reshapes which stars are visible
- Searching adds new stars from beyond your library
- Exploring other users reveals distant galaxies
- Every tab is a different lens on the same universe

## Graph Hierarchy

### Level 1 — Macro Clusters
Fiction and Non-fiction. The two hemispheres of the universe.

### Level 2 — Subject Clusters (Nebulae)
The primary gravity wells: Philosophy, Sci-fi, History, Economics, Psychology. Visible as bright, labelled star systems. Sized by book count.

### Level 3 — Books (Stars)
Individual works. Small glowing points within clusters. Bridge books sit between clusters with connections to both. Visible when zoomed in or when a cluster is expanded.

### Level 4 — Metadata (hidden until interaction)
Author, notes, highlights, sellers, listings, similar users. Appear in a detail panel when a star is tapped.

## Visual Design Principles

- **Deep space aesthetic**: near-black background (#05070A), subtle gradient, faint starfield
- **Stars, not circles**: nodes have radial glow, inner core, outer halo
- **Constellation lines, not edges**: thin, faint, low-opacity connections
- **Depth through opacity**: focused elements are bright, background elements fade to near-invisible
- **Labels emerge on interaction**: no clutter by default
- **Calm motion**: slow drift, high damping, no jitter
- **Dark everything**: the entire app follows the space theme, not just the graph

## Tab Lenses

Three tabs are lenses on the same universe — they never unmount the graph:

| Tab | What it does |
|---|---|
| Universe | Your constellation: stats, filters, capture tools, search (OL + local toggle). Graph toggles: Subject/Theme, Recs, Path. |
| World | Other users' galaxies become visible. Shared books bridge between. (Placeholder) |
| Profile | Your universe with identity overlay — stats, density, reading shape. |

## Marketplace Overlay

Seller and listing nodes are part of the data model but hidden by default. When activated, they appear as faint orbiting markers around book stars — price and availability as contextual data, never as primary structure.

## Product Philosophy

- **Universe first** — the graph is the entire interface
- **Clusters are nebulae** — ideas are the primary structure
- **Identity through shape** — your reading identity is the shape of your galaxy
- **Discovery through exploration** — zoom, pan, follow constellation lines
- **Atmosphere over UI** — prioritise immersion, subtlety, and calm over explicit controls
