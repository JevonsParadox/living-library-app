"use client";

import { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect, useReducer, type ReactNode, type MutableRefObject } from "react";
import * as THREE from "three";
import type { NbRegion, UserBookState, BookOwnership, BookStatus } from "./nebula-types";
import type { NbBookWithCoords } from "./fetch-nebula-data";
import { sortPath, type PathSortMode } from "./path-sort";
import { getSemanticNeighbors, getSemanticNeighborsBatch } from "@/app/(nebula)/nebula/actions";
import { bookWorldPos, buildRegionAnchorMap, regionWorldPos, type RegionAnchorMap } from "./world-scale";
import { computeIllumination } from "./illumination";

export type SimilarMode = "spatial" | "semantic";
export type ZoomLevel = "galaxy" | "constellation" | "star";
export type ViewMode = "2d" | "3d";

const VIEW_MODE_STORAGE_KEY = "nebula:viewMode";

const GALAXY_THRESHOLD = 5;
const STAR_THRESHOLD = 2;

export interface CameraDirectionData {
  forward: THREE.Vector3;
  position: THREE.Vector3;
  /** Camera distance to the OrbitControls target — the actual "zoom-in"
   *  signal. Distance from world origin is a bad proxy because the galaxy
   *  is laid out around the origin and any off-centre view (e.g. after a
   *  flythrough) inflates origin distance without changing zoom level.
   *  Populated by CameraController each frame; seeded at construction so
   *  the first poll before the controller mounts reads a sensible value. */
  distanceToTarget: number;
}

export interface TasteProfile {
  centroid: { x: number; y: number; z: number };
  topRegions: Array<{ regionId: string; name: string; colorHex: string; count: number }>;
  totalBooks: number;
  regionsTouched: number;
  /** Counts of every library entry (owned + wishlist) by user-facing label. */
  stateBreakdown: {
    read: number;
    reading: number;
    nextUp: number;
    onShelf: number;
    wishlist: number;
  };
}

interface FlyTarget {
  x: number;
  y: number;
  z: number;
  cameraDistance?: number; // optional override for the camera offset; default is the tighter zoom
}

const HOME_TARGET: FlyTarget = { x: 0, y: 0, z: 0, cameraDistance: 4 };

interface NebulaState {
  books: NbBookWithCoords[];
  regions: NbRegion[];
  seriesNames: Record<string, string>;
  selectedBookId: string | null;
  hoveredBookId: string | null;
  flyTarget: FlyTarget | null;
  searchQuery: string;
  userLibrary: Map<string, UserBookState>;
  showMyShelf: boolean;
  showUploadPanel: boolean;
  showPath: boolean;
  userPath: Array<{ bookId: string; x: number; y: number; z: number; title: string; readAt: string | null; daysGapToNext: number | null }>;
  recommendations: Array<{ bookId: string; title: string; authorName: string | null; coverUrl: string | null; genre: string | null; score: number; reason: string }>;
  focusedRegionId: string | null;
  pathSortMode: PathSortMode;
  loading: boolean;
  /** Render-time multiplier applied on top of WORLD_SCALE in every coord-using
   *  component. 1.0 = baseline; >1 spreads books out, <1 pulls them tighter.
   *  Wired to a slider in the bottom-right of NebulaView. */
  spacingMultiplier: number;
  /** "3d" = R3F scene (default), "2d" = force-graph-2d. Persisted to localStorage. */
  viewMode: ViewMode;
}

interface NebulaContextValue extends NebulaState {
  setSelectedBook: (id: string | null) => void;
  setHoveredBook: (id: string | null) => void;
  setFlyTarget: (target: FlyTarget | null) => void;
  setSearchQuery: (q: string) => void;
  setShowMyShelf: (show: boolean) => void;
  setShowUploadPanel: (show: boolean) => void;
  setShowPath: (show: boolean) => void;
  setUserPath: (path: NebulaState["userPath"]) => void;
  setUserPathBookDate: (bookId: string, readAt: string | null) => void;
  setPathSortMode: (mode: PathSortMode) => void;
  /** userPath sorted by the current pathSortMode — shared by 3D line + tray */
  sortedPath: NebulaState["userPath"];
  setRecommendations: (recs: NebulaState["recommendations"]) => void;
  // Library mutations (optimistic)
  addToShelf: (bookId: string, partial?: Partial<Omit<UserBookState, "bookId">>) => void;
  removeFromShelf: (bookId: string) => void;
  updateBookState: (bookId: string, partial: Partial<Omit<UserBookState, "bookId">>) => void;
  /** Append a newly-created shell to the 3D scene so it's visible without a refresh. */
  addBookToGalaxy: (book: NbBookWithCoords) => void;
  /** Live render-time spacing multiplier setter — driven by SpacingSlider. */
  setSpacingMultiplier: (value: number) => void;
  /** Toggle 2D/3D rendering — driven by the ViewModeToggle pill. */
  setViewMode: (mode: ViewMode) => void;
  // Read-only helpers derived from userLibrary
  isOnShelf: (bookId: string) => boolean;
  isOwned: (bookId: string) => boolean;
  isWishlist: (bookId: string) => boolean;
  getBookState: (bookId: string) => UserBookState | undefined;
  selectedBook: NbBookWithCoords | null;
  flyToBook: (bookId: string) => void;
  flyToRegion: (regionId: string) => void;
  cameraDirectionRef: MutableRefObject<CameraDirectionData>;
  similarBookIds: string[];
  similarMode: SimilarMode;
  setSimilarMode: (mode: SimilarMode) => void;
  /** True briefly after switching to semantic mode while the network fetch is in flight. */
  similarLoading: boolean;
  tasteProfile: TasteProfile | null;
  zoomLevel: ZoomLevel;
  /** Lookup from region.id → DB-space anchor xyz. Stable across renders. */
  regionAnchorMap: RegionAnchorMap;
  /** Many-to-many illumination: each illuminated bookId → shelf bookIds that
   *  recommend it (via semantic edges, with spatial fallback). Used by paint
   *  rules and by D8 hover-trace. Empty when shelf is empty. */
  illuminationMap: Map<string, string[]>;
  /** Set of illuminated bookIds (the keys of illuminationMap), for O(1)
   *  `has()` checks in render hot paths. */
  illuminatedBookIds: Set<string>;
  /** regionId → number of shelf books in that region. Drives D4 planet
   *  brightness and D2 0-to-1 region awakening. */
  regionShelfCounts: Map<string, number>;
  /** D2 region awakening signal: the regionId + Date.now() of the most
   *  recent 0→N transition in regionShelfCounts. Renderers compare
   *  Date.now() to `at` and stop the flash after the duration window
   *  elapses; no manual clear. Both null on initial mount and after a
   *  flash window expires. */
  awakenedRegion: { regionId: string | null; at: number | null };
  /** D1 ignition signal: the bookId + Date.now() of the most recent
   *  addToShelf call. Drives the source-pulse animation (the new shelf
   *  book brightens + grows briefly) and the cascade timing. Both null
   *  until first add. */
  ignitedBook: { bookId: string | null; at: number | null };
  /** Set of bookIds that became illuminated as a direct result of the
   *  most recent addToShelf — i.e. they weren't in illuminatedBookIds
   *  before the add. Drives D1's staggered fade-in cascade. Stored in
   *  a ref because consumers read in useFrame / paintNode hot paths
   *  every frame, and React state would re-render unnecessarily. */
  newlyIlluminatedRef: MutableRefObject<Set<string>>;
  /** D3 north-star centroid: unweighted average world position of all
   *  shelf books (owned + wishlist). Null when shelf is empty. Drives
   *  the NorthStar marker — drifts as the shelf grows. Distinct from
   *  `tasteProfile.centroid` (which is owned-only, popularity-weighted,
   *  min 3 books, used by the panel stats). */
  shelfCentroid: [number, number, number] | null;
  /** D6 reading-trail comet: the user's most-recently-added shelf books,
   *  newest first, capped at 3. Drives the gold trail polyline +
   *  particle wake. Empty array when shelf is empty. */
  recentShelfBooks: UserBookState[];
  /** D7 fog of exploration: bookId → normalised distance (0..1) from each
   *  background-tier book to the nearest shelf-or-illuminated book. 0 =
   *  next to your activity, 1 = farthest. Books on shelf or illuminated
   *  are absent from the map (no fog). Empty when shelf is empty —
   *  consumers should treat absence as "no fog applied". */
  fogLevel: Map<string, number>;
}

const NebulaContext = createContext<NebulaContextValue | null>(null);

export function NebulaProvider({
  children,
  initialBooks = [],
  initialRegions = [],
  initialLibrary = [],
  initialSeriesNames = {},
}: {
  children: ReactNode;
  initialBooks?: NbBookWithCoords[];
  initialRegions?: NbRegion[];
  initialLibrary?: UserBookState[];
  initialSeriesNames?: Record<string, string>;
}) {
  const [state, setState] = useState<NebulaState>({
    books: initialBooks,
    regions: initialRegions,
    seriesNames: initialSeriesNames,
    selectedBookId: null,
    hoveredBookId: null,
    flyTarget: null,
    searchQuery: "",
    userLibrary: new Map(initialLibrary.map((s) => [s.bookId, s])),
    showMyShelf: false,
    showUploadPanel: false,
    showPath: false,
    userPath: [],
    recommendations: [],
    focusedRegionId: null,
    pathSortMode: "constellation",
    loading: false,
    // 4.0× has been chosen by visual review as the natural default — the
    // user can tighten via the SpacingSlider if they want a denser galaxy.
    spacingMultiplier: 4,
    // 3D is the default; localStorage hydration runs in an effect below so
    // the first render is deterministic (matters for SSR + hydration parity).
    viewMode: "3d",
  });

  // Camera direction — written by CameraController each frame, read by compass.
  // Uses a ref so frame updates don't trigger re-renders.
  const cameraDirectionRef = useRef<CameraDirectionData>({
    forward: new THREE.Vector3(0, 0, -1),
    position: new THREE.Vector3(0, 0, 4),
    // Matches the default camera position [0,0,4] looking at origin.
    distanceToTarget: 4,
  });

  // Zoom level — polled from camera-to-target distance (not camera-to-origin)
  // so flying to an off-centre cluster doesn't spuriously flip to "galaxy"
  // and hide BookCloud + IlluminationEdges + SimilarReadsEdges + SeriesLabels.
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>("constellation");
  useEffect(() => {
    const tick = () => {
      const d = cameraDirectionRef.current.distanceToTarget;
      const next: ZoomLevel = d > GALAXY_THRESHOLD ? "galaxy" : d < STAR_THRESHOLD ? "star" : "constellation";
      setZoomLevel((prev) => (prev !== next ? next : prev));
    };
    const id = setInterval(tick, 150);
    tick();
    return () => clearInterval(id);
  }, []);

  const setSelectedBook = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedBookId: id }));
  }, []);

  const setHoveredBook = useCallback((id: string | null) => {
    setState((s) => ({ ...s, hoveredBookId: id }));
  }, []);

  const setFlyTarget = useCallback((target: FlyTarget | null) => {
    setState((s) => ({ ...s, flyTarget: target }));
  }, []);

  const setSearchQuery = useCallback((q: string) => {
    setState((s) => ({ ...s, searchQuery: q }));
  }, []);

  const setShowMyShelf = useCallback((show: boolean) => {
    setState((s) => ({ ...s, showMyShelf: show }));
  }, []);

  const setShowUploadPanel = useCallback((show: boolean) => {
    setState((s) => ({ ...s, showUploadPanel: show }));
  }, []);

  const setShowPath = useCallback((show: boolean) => {
    setState((s) => ({ ...s, showPath: show }));
  }, []);

  const setUserPath = useCallback((path: NebulaState["userPath"]) => {
    setState((s) => ({ ...s, userPath: path }));
  }, []);

  const setPathSortMode = useCallback((mode: PathSortMode) => {
    setState((s) => ({ ...s, pathSortMode: mode }));
  }, []);

  // Optimistic patch — update a single book's readAt in the path and recompute
  // adjacent daysGapToNext values. The 3D path line stays in its current
  // order; only the readAt metadata refreshes.
  const setUserPathBookDate = useCallback((bookId: string, readAt: string | null) => {
    setState((s) => {
      const idx = s.userPath.findIndex((n) => n.bookId === bookId);
      if (idx === -1) return s;
      const next = s.userPath.map((n) => ({ ...n }));
      next[idx].readAt = readAt;

      // Recompute gap into this node (from prev) and out of it (to next)
      const recomputeGap = (i: number) => {
        if (i < 0 || i >= next.length - 1) return;
        const a = next[i].readAt;
        const b = next[i + 1].readAt;
        if (a && b) {
          next[i].daysGapToNext = Math.round(
            (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24)
          );
        } else {
          next[i].daysGapToNext = null;
        }
      };
      recomputeGap(idx - 1);
      recomputeGap(idx);

      return { ...s, userPath: next };
    });
  }, []);

  const setRecommendations = useCallback((recs: NebulaState["recommendations"]) => {
    setState((s) => ({ ...s, recommendations: recs }));
  }, []);

  // D1 ignition signal — fired from addToShelf below, read by BookCloud's
  // useFrame and NebulaView2D's paintNode to drive the source-pulse +
  // cascade animations. Single-slot; rapid sequential adds replace it.
  const [ignitedBook, setIgnitedBook] = useState<{
    bookId: string | null;
    at: number | null;
  }>({ bookId: null, at: null });

  const addToShelf = useCallback((bookId: string, partial?: Partial<Omit<UserBookState, "bookId">>) => {
    setState((s) => {
      const next = new Map(s.userLibrary);
      const existing = next.get(bookId);
      const ownership: BookOwnership = partial?.ownership ?? existing?.ownership ?? "owned";
      const status: BookStatus = partial?.status ?? existing?.status ?? "unread";
      next.set(bookId, {
        bookId,
        ownership,
        status,
        startedAt: partial?.startedAt ?? existing?.startedAt ?? null,
        finishedAt: partial?.finishedAt ?? existing?.finishedAt ?? null,
        readAt: partial?.readAt ?? existing?.readAt ?? null,
        // Newly-added books get the current timestamp so the D6 trail
        // picks them up immediately. Existing rows retain their
        // server-assigned addedAt across status flips so the trail
        // continues to reflect "most recently added" not "most recently
        // touched".
        addedAt: existing?.addedAt ?? new Date().toISOString(),
      });
      return { ...s, userLibrary: next };
    });
    // Fire the burst on every shelf action — new add, re-add, or status
    // flip via this entrypoint. The cascade naturally no-ops when the
    // illumination set hasn't changed (which is the case for re-adds).
    setIgnitedBook({ bookId, at: Date.now() });
  }, []);

  const removeFromShelf = useCallback((bookId: string) => {
    setState((s) => {
      const next = new Map(s.userLibrary);
      next.delete(bookId);
      return { ...s, userLibrary: next };
    });
  }, []);

  const updateBookState = useCallback((bookId: string, partial: Partial<Omit<UserBookState, "bookId">>) => {
    let didUpdate = false;
    setState((s) => {
      const existing = s.userLibrary.get(bookId);
      if (!existing) return s;
      didUpdate = true;
      const next = new Map(s.userLibrary);
      next.set(bookId, { ...existing, ...partial });
      return { ...s, userLibrary: next };
    });
    // Status / ownership change on a book that's on the shelf — fire the
    // burst from that book's position so each shelf action gives
    // celebratory feedback. Trail polyline is unchanged (still ordered
    // by addedAt), but the particle wake spawns from the changed book.
    if (didUpdate) {
      setIgnitedBook({ bookId, at: Date.now() });
    }
  }, []);

  // Region anchors stay fixed in world space — only the book's offset from
  // its region anchor scales with the slider. Built once from initialRegions.
  const regionAnchorMap = useMemo(() => buildRegionAnchorMap(initialRegions), [initialRegions]);

  const flyToBook = useCallback((bookId: string) => {
    const book = initialBooks.find((b) => b.id === bookId);
    if (book) {
      // Read current spacingMultiplier inside setState so we fly to the live
      // scaled position. Region-fixed math: regions stay put, books expand
      // outward from their anchor.
      setState((s) => {
        const [x, y, z] = bookWorldPos(book, regionAnchorMap, s.spacingMultiplier);
        return {
          ...s,
          selectedBookId: bookId,
          focusedRegionId: null,
          flyTarget: { x, y, z },
        };
      });
    }
  }, [initialBooks, regionAnchorMap]);

  // Toggle behaviour: clicking the currently focused region flies the camera
  // back to a wide home view; clicking any other region focuses there.
  // Region anchors are not affected by the spacing slider.
  const flyToRegion = useCallback((regionId: string) => {
    setState((s) => {
      if (s.focusedRegionId === regionId) {
        return {
          ...s,
          selectedBookId: null,
          focusedRegionId: null,
          flyTarget: { ...HOME_TARGET },
        };
      }
      const region = initialRegions.find((r) => r.id === regionId);
      if (!region) return s;
      const [x, y, z] = regionWorldPos(region);
      return {
        ...s,
        selectedBookId: null,
        focusedRegionId: regionId,
        flyTarget: { x, y, z },
      };
    });
  }, [initialRegions]);

  const setSpacingMultiplier = useCallback((value: number) => {
    setState((s) => ({ ...s, spacingMultiplier: Math.max(0.1, Math.min(5, value)) }));
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setState((s) => ({ ...s, viewMode: mode }));
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
      } catch {
        // localStorage may be unavailable (private mode, quota); not critical.
      }
    }
  }, []);

  // Hydrate viewMode from localStorage once on mount. Doing this in an effect
  // (rather than useState initialiser) keeps SSR + first-render deterministic.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === "2d" || stored === "3d") {
        setState((s) => (s.viewMode === stored ? s : { ...s, viewMode: stored }));
      }
    } catch {
      // ignore
    }
  }, []);

  const selectedBook = state.selectedBookId
    ? state.books.find((b) => b.id === state.selectedBookId) ?? null
    : null;

  // userPath sorted by current mode — shared by NebulaPathLine and PathBooksTray
  // so the 3D gold tube reshapes when the user toggles the tray sort buttons.
  const sortedPath = useMemo(
    () => sortPath(state.userPath, state.pathSortMode),
    [state.userPath, state.pathSortMode]
  );

  // --- Similar reads: spatial (cheap) vs semantic (server-fetched, cached) ---

  const [similarMode, setSimilarMode] = useState<SimilarMode>("spatial");

  // Spatial: O(n) over ~4500 books, recomputed only when selection changes.
  const spatialSimilarBookIds = useMemo(() => {
    if (!selectedBook) return [];
    const sx = selectedBook.x, sy = selectedBook.y, sz = selectedBook.z;
    const scored: Array<{ id: string; d2: number }> = [];
    for (const b of state.books) {
      if (b.id === selectedBook.id) continue;
      const dx = b.x - sx, dy = b.y - sy, dz = b.z - sz;
      scored.push({ id: b.id, d2: dx * dx + dy * dy + dz * dz });
    }
    scored.sort((a, b) => a.d2 - b.d2);
    return scored.slice(0, 3).map((s) => s.id);
  }, [selectedBook, state.books]);

  // Semantic: fetched from nb_book_edges, cached per bookId so re-selecting is instant.
  const semanticCache = useRef<Map<string, string[]>>(new Map());
  const [, bumpSemanticVersion] = useReducer((v: number) => v + 1, 0);
  const [similarLoading, setSimilarLoading] = useState(false);

  useEffect(() => {
    if (similarMode !== "semantic") {
      setSimilarLoading(false);
      return;
    }
    const id = state.selectedBookId;
    if (!id) {
      setSimilarLoading(false);
      return;
    }
    if (semanticCache.current.has(id)) {
      setSimilarLoading(false);
      return;
    }
    setSimilarLoading(true);
    let cancelled = false;
    getSemanticNeighbors(id, 3).then((ids) => {
      if (cancelled) return;
      semanticCache.current.set(id, ids);
      setSimilarLoading(false);
      bumpSemanticVersion();
    });
    return () => { cancelled = true; };
  }, [similarMode, state.selectedBookId]);

  const similarBookIds = useMemo(() => {
    if (similarMode === "spatial") return spatialSimilarBookIds;
    if (!state.selectedBookId) return [];
    return semanticCache.current.get(state.selectedBookId) ?? [];
    // semanticCache is mutated above; bumpSemanticVersion forces a re-eval
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarMode, spatialSimilarBookIds, state.selectedBookId, similarLoading]);

  // Taste profile: spatial centroid + top regions of the user's owned books.
  // Weighted by popularity so the marker leans toward books the user
  // actually reaches for. Wishlist excluded — taste = what you've actually got.
  // Returns null until there are >= 3 owned books.
  const tasteProfile = useMemo<TasteProfile | null>(() => {
    const ownedIds = new Set<string>();
    for (const [id, st] of state.userLibrary) {
      if (st.ownership === "owned") ownedIds.add(id);
    }
    if (ownedIds.size < 3) return null;

    const shelfBooks = state.books.filter((b) => ownedIds.has(b.id));
    if (shelfBooks.length < 3) return null;

    // Compute the centroid in world space using the live spacingMultiplier
    // so the taste marker tracks the slider correctly. Consumers should treat
    // tasteProfile.centroid as already-scaled world coords (no further
    // multiplication by WORLD_SCALE).
    let wx = 0, wy = 0, wz = 0, wsum = 0;
    const regionCounts = new Map<string, number>();

    for (const b of shelfBooks) {
      const w = Math.max(b.popularity_score, 1) / 100;
      const [bx, by, bz] = bookWorldPos(b, regionAnchorMap, state.spacingMultiplier);
      wx += bx * w;
      wy += by * w;
      wz += bz * w;
      wsum += w;
      if (b.region_id) {
        regionCounts.set(b.region_id, (regionCounts.get(b.region_id) ?? 0) + 1);
      }
    }

    const centroid = { x: wx / wsum, y: wy / wsum, z: wz / wsum };

    const regionLookup = new Map(state.regions.map((r) => [r.id, r]));
    const topRegions = Array.from(regionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([regionId, count]) => {
        const r = regionLookup.get(regionId);
        return {
          regionId,
          name: r?.name ?? "Unknown",
          colorHex: r?.color_hex ?? "#8B9DC3",
          count,
        };
      });

    // Count every library entry by user-facing label (owned + wishlist).
    const stateBreakdown = { read: 0, reading: 0, nextUp: 0, onShelf: 0, wishlist: 0 };
    for (const st of state.userLibrary.values()) {
      if (st.ownership === "wishlist") {
        stateBreakdown.wishlist += 1;
      } else if (st.status === "read") {
        stateBreakdown.read += 1;
      } else if (st.status === "reading") {
        stateBreakdown.reading += 1;
      } else if (st.status === "next_up") {
        stateBreakdown.nextUp += 1;
      } else {
        stateBreakdown.onShelf += 1;
      }
    }

    return {
      centroid,
      topRegions,
      totalBooks: shelfBooks.length,
      regionsTouched: regionCounts.size,
      stateBreakdown,
    };
  }, [state.userLibrary, state.books, state.regions, state.spacingMultiplier, regionAnchorMap]);

  // --- Illumination: shelf books light up ~6 nearby candidates each ---
  //
  // Edge cache mirrors the `semanticCache` pattern: per-source-bookId list
  // of neighbours read from nb_book_edges. Filled lazily by the effect
  // below as new shelf books appear; never invalidated (edges are stable
  // for a given source). A version counter triggers re-renders when the
  // ref mutates without going through setState.
  const shelfEdgesCache = useRef<Map<string, string[]>>(new Map());
  const [edgesCacheVersion, bumpEdgesCacheVersion] = useReducer((v: number) => v + 1, 0);

  // The shelf id set used as a memo key — a Set's identity changes whenever
  // userLibrary's keys change, but content can be reused across renders so
  // downstream memos don't recompute on irrelevant patches (status flips
  // that don't move a book on/off the shelf).
  const shelfBookIds = useMemo(() => {
    return new Set(state.userLibrary.keys());
  }, [state.userLibrary]);

  // When the shelf grows, fetch semantic edges for any new source bookIds
  // not already in the cache. One round-trip via getSemanticNeighborsBatch,
  // even on first load with a 50-book shelf — 50 sequential round-trips
  // would be slow. Sources with no edges in the table are simply absent
  // from the response; computeIllumination falls back to a spatial KNN
  // for those.
  useEffect(() => {
    const missing: string[] = [];
    for (const id of shelfBookIds) {
      if (!shelfEdgesCache.current.has(id)) missing.push(id);
    }
    if (missing.length === 0) return;

    let cancelled = false;
    getSemanticNeighborsBatch(missing, 6).then((batchResult) => {
      if (cancelled) return;
      // Mark all requested ids as fetched, even those with empty arrays —
      // an absent entry would re-fire the fetch on every render.
      for (const id of missing) {
        shelfEdgesCache.current.set(id, batchResult[id] ?? []);
      }
      bumpEdgesCacheVersion();
    });
    return () => {
      cancelled = true;
    };
  }, [shelfBookIds]);

  const { illuminationMap, illuminatedBookIds } = useMemo(() => {
    return computeIllumination(state.books, shelfBookIds, shelfEdgesCache.current, 6);
    // Re-derive when the book set changes, the shelf changes, or the cache
    // version bumps. shelfEdgesCache.current itself is stable, so referencing
    // it directly is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.books, shelfBookIds, edgesCacheVersion]);

  // regionId → shelf count. Drives D4 (planet brightness scales with shelf
  // count) and the 0→1 transition detection for D2 (region awakening).
  const regionShelfCounts = useMemo(() => {
    const bookById = new Map(state.books.map((b) => [b.id, b]));
    const counts = new Map<string, number>();
    for (const id of shelfBookIds) {
      const b = bookById.get(id);
      if (b?.region_id) {
        counts.set(b.region_id, (counts.get(b.region_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [state.books, shelfBookIds]);

  // D7 fog of exploration — for each background-tier book, the
  // normalised distance to the nearest shelf or illuminated book. Zero
  // for books that ARE shelf or illuminated (they're absent from the
  // map). One pass per shelf change: O(books × (shelf + illuminated))
  // ≈ 12k × 150 ≈ 1.8M ops, ~30 ms. Squared distance avoids sqrt;
  // observed-max normalisation auto-scales.
  const fogLevel = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    if (shelfBookIds.size === 0) return m;
    const activeIds = new Set<string>(shelfBookIds);
    for (const id of illuminatedBookIds) activeIds.add(id);
    const activeBooks: NbBookWithCoords[] = [];
    for (const b of state.books) {
      if (activeIds.has(b.id)) activeBooks.push(b);
    }
    if (activeBooks.length === 0) return m;

    let maxD2 = 0;
    const d2ByBook = new Map<string, number>();
    for (const b of state.books) {
      if (activeIds.has(b.id)) continue;
      let nearestD2 = Infinity;
      for (const ab of activeBooks) {
        const dx = b.x - ab.x;
        const dy = b.y - ab.y;
        const dz = b.z - ab.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < nearestD2) nearestD2 = d2;
      }
      d2ByBook.set(b.id, nearestD2);
      if (nearestD2 > maxD2) maxD2 = nearestD2;
    }
    if (maxD2 === 0) return m;
    for (const [id, d2] of d2ByBook) {
      m.set(id, d2 / maxD2);
    }
    return m;
  }, [state.books, shelfBookIds, illuminatedBookIds]);

  // D6 reading-trail comet — the user's three most-recently-added shelf
  // books, newest first. Sorted by addedAt desc with nulls ordered last so
  // pre-migration rows (no timestamp) don't pollute the head of the trail.
  const recentShelfBooks = useMemo<UserBookState[]>(() => {
    const all = Array.from(state.userLibrary.values());
    all.sort((a, b) => {
      if (!a.addedAt && !b.addedAt) return 0;
      if (!a.addedAt) return 1;
      if (!b.addedAt) return -1;
      return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    });
    return all.slice(0, 3);
  }, [state.userLibrary]);

  // D3 north-star centroid: unweighted average world position of all shelf
  // books (owned + wishlist). 1-book shelf → marker sits on that book; n-book
  // shelf → marker at the average position. Null when shelf is empty.
  const shelfCentroid = useMemo<[number, number, number] | null>(() => {
    if (shelfBookIds.size === 0) return null;
    const bookById = new Map(state.books.map((b) => [b.id, b]));
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const id of shelfBookIds) {
      const b = bookById.get(id);
      if (!b) continue;
      const [wx, wy, wz] = bookWorldPos(b, regionAnchorMap, state.spacingMultiplier);
      sx += wx;
      sy += wy;
      sz += wz;
      n += 1;
    }
    if (n === 0) return null;
    return [sx / n, sy / n, sz / n];
  }, [state.books, shelfBookIds, regionAnchorMap, state.spacingMultiplier]);

  // D1 cascade: track which illuminated books are NEWLY illuminated by
  // the most recent shelf add, so the cascade fade-in only fires for
  // those (books that were already illuminated by other shelf books
  // shouldn't disappear-and-reappear). Initial mount seeds the prev ref
  // and exits — no cascade with the user's existing illuminations on
  // page load.
  const newlyIlluminatedRef = useRef<Set<string>>(new Set());
  const prevIlluminatedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const prev = prevIlluminatedRef.current;
    if (prev === null) {
      // First observation: seed and exit. No cascade.
      prevIlluminatedRef.current = new Set(illuminatedBookIds);
      return;
    }
    const newly = new Set<string>();
    for (const id of illuminatedBookIds) {
      if (!prev.has(id)) newly.add(id);
    }
    newlyIlluminatedRef.current = newly;
    prevIlluminatedRef.current = new Set(illuminatedBookIds);
  }, [illuminatedBookIds]);

  // D2 region awakening: detect 0→N transitions in regionShelfCounts and
  // pulse a signal renderers can react to. Initial mount seeds the prev
  // ref to the first observed counts (so existing shelf books don't
  // trigger flashes on page load); subsequent runs diff against prev.
  const prevRegionShelfCountsRef = useRef<Map<string, number> | null>(null);
  const [awakenedRegion, setAwakenedRegion] = useState<{
    regionId: string | null;
    at: number | null;
  }>({ regionId: null, at: null });
  useEffect(() => {
    const prev = prevRegionShelfCountsRef.current;
    if (prev === null) {
      // First observation: seed and exit. No flash.
      prevRegionShelfCountsRef.current = new Map(regionShelfCounts);
      return;
    }
    // Diff: any region whose previous count was 0 (or absent) and now ≥ 1
    // is awakening. Single-signal — only the most recent transition is
    // tracked; in the rare case of two simultaneous additions, the second
    // wins. Acceptable for v1; promote to a Map<regionId, timestamp> if it
    // matters later.
    for (const [regionId, count] of regionShelfCounts) {
      if (count >= 1 && (prev.get(regionId) ?? 0) === 0) {
        setAwakenedRegion({ regionId, at: Date.now() });
        break;
      }
    }
    prevRegionShelfCountsRef.current = new Map(regionShelfCounts);
  }, [regionShelfCounts]);

  // Read-only helpers — derived from userLibrary, change identity each render
  // but they're cheap and used in hot paths (BookCloud) — so memoize on
  // the Map identity.
  const isOnShelf = useCallback((bookId: string) => state.userLibrary.has(bookId), [state.userLibrary]);
  const isOwned = useCallback(
    (bookId: string) => state.userLibrary.get(bookId)?.ownership === "owned",
    [state.userLibrary]
  );
  const isWishlist = useCallback(
    (bookId: string) => state.userLibrary.get(bookId)?.ownership === "wishlist",
    [state.userLibrary]
  );
  const getBookState = useCallback(
    (bookId: string) => state.userLibrary.get(bookId),
    [state.userLibrary]
  );

  const addBookToGalaxy = useCallback((book: NbBookWithCoords) => {
    setState((s) => {
      if (s.books.some((b) => b.id === book.id)) return s;
      return { ...s, books: [...s.books, book] };
    });
  }, []);

  return (
    <NebulaContext.Provider
      value={{
        ...state,
        setSelectedBook, setHoveredBook, setFlyTarget, setSearchQuery,
        setShowMyShelf, setShowUploadPanel, setShowPath, setUserPath, setUserPathBookDate, setPathSortMode, sortedPath, setRecommendations,
        addToShelf, removeFromShelf, updateBookState, addBookToGalaxy,
        setSpacingMultiplier, setViewMode,
        isOnShelf, isOwned, isWishlist, getBookState,
        selectedBook, flyToBook, flyToRegion,
        cameraDirectionRef, similarBookIds, similarMode, setSimilarMode, similarLoading, tasteProfile, zoomLevel,
        regionAnchorMap,
        illuminationMap, illuminatedBookIds, regionShelfCounts, awakenedRegion,
        ignitedBook, newlyIlluminatedRef,
        shelfCentroid, recentShelfBooks,
        fogLevel,
      }}
    >
      {children}
    </NebulaContext.Provider>
  );
}

export function useNebula() {
  const ctx = useContext(NebulaContext);
  if (!ctx) throw new Error("useNebula must be used within NebulaProvider");
  return ctx;
}
