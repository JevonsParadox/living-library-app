/**
 * Deterministic seeded coordinates. Same (canonical_genre, author) pair always
 * produces the same offset within its region — preserves visual stability across
 * seed re-runs.
 */

import { createHash } from "crypto";

export interface RegionAnchor {
  id: string;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
}

const REGION_CLOUD_RADIUS = 0.35;
const Z_JITTER_HALF_RANGE = 0.15;

export function seededCoordsFor(
  region: RegionAnchor,
  canonicalGenre: string,
  authorName: string,
): { x: number; y: number; z: number } {
  const hash = createHash("sha256")
    .update(`${canonicalGenre}|${authorName.toLowerCase()}`)
    .digest();

  const bytesToUnit = (offset: number): number => {
    const n = hash.readUInt16BE(offset);
    return n / 0xffff;
  };

  const angle = bytesToUnit(0) * 2 * Math.PI;
  const radius = bytesToUnit(2) * REGION_CLOUD_RADIUS;
  const zJitter = (bytesToUnit(4) - 0.5) * 2 * Z_JITTER_HALF_RANGE;

  return {
    x: region.anchor_x + Math.cos(angle) * radius,
    y: region.anchor_y + Math.sin(angle) * radius,
    z: region.anchor_z + zJitter,
  };
}
