/**
 * Single source of truth for converting DB-space coordinates into world-space
 * Three.js positions.
 *
 * Region anchors stay fixed in world space — they only multiply by the static
 * BASE_WORLD_SCALE. Books expand outward from their region's anchor by an
 * additional `multiplier` factor controlled by the SpacingSlider.
 *
 *   region_world  = region.anchor × BASE
 *   book_world    = region.anchor × BASE
 *               + (book.coord - region.anchor) × BASE × multiplier
 *
 * That way, increasing the slider doesn't push regions apart from each other —
 * it only spreads the books within a region outward from its anchor, which is
 * the visual the user is asking for.
 */

export const BASE_WORLD_SCALE = 2.5;

export interface RegionAnchorXYZ {
  x: number;
  y: number;
  z: number;
}

export type RegionAnchorMap = Map<string, RegionAnchorXYZ>;

export interface BookCoordLike {
  x: number;
  y: number;
  z: number;
  region_id: string | null;
}

export interface RegionAnchorLike {
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
}

/** Build a Map<region_id, {x,y,z}> from a list of regions. */
export function buildRegionAnchorMap(
  regions: Array<{ id: string } & RegionAnchorLike>,
): RegionAnchorMap {
  const m: RegionAnchorMap = new Map();
  for (const r of regions) {
    m.set(r.id, { x: r.anchor_x, y: r.anchor_y, z: r.anchor_z });
  }
  return m;
}

/**
 * Compute the world-space position of a book given the live spacing
 * multiplier. Books with no region_id (rare; pre-Phase-D legacy) fall back to
 * a uniform scale around the origin.
 */
export function bookWorldPos(
  book: BookCoordLike,
  regionAnchors: RegionAnchorMap,
  multiplier: number,
): [number, number, number] {
  const anchor = book.region_id ? regionAnchors.get(book.region_id) : undefined;
  if (!anchor) {
    const k = BASE_WORLD_SCALE * multiplier;
    return [book.x * k, book.y * k, book.z * k];
  }
  const ax = anchor.x * BASE_WORLD_SCALE;
  const ay = anchor.y * BASE_WORLD_SCALE;
  const az = anchor.z * BASE_WORLD_SCALE;
  const dx = (book.x - anchor.x) * BASE_WORLD_SCALE * multiplier;
  const dy = (book.y - anchor.y) * BASE_WORLD_SCALE * multiplier;
  const dz = (book.z - anchor.z) * BASE_WORLD_SCALE * multiplier;
  return [ax + dx, ay + dy, az + dz];
}

/** Region anchors stay fixed in world space — multiplier intentionally ignored. */
export function regionWorldPos(r: RegionAnchorLike): [number, number, number] {
  return [
    r.anchor_x * BASE_WORLD_SCALE,
    r.anchor_y * BASE_WORLD_SCALE,
    r.anchor_z * BASE_WORLD_SCALE,
  ];
}
