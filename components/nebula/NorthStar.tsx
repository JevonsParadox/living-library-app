"use client";

/**
 * D3 north star — a soft pulsing gold marker at the centroid of the user's
 * shelf books. Pole-star metaphor: shows where your reading life lives in
 * the cosmos. Drifts smoothly (~800 ms ease) as you add books and the
 * centroid shifts.
 *
 * Reads `shelfCentroid` from context (unweighted, all shelf books, min 1).
 * Mounts only when shelfCentroid is non-null. The first book ever added
 * snaps the marker into place (no ease — there's nothing to ease from);
 * subsequent additions ease.
 *
 * Replaces the old TasteMarker which only mounted at ≥3 owned books and
 * was popularity-weighted. The TasteProfilePanel still consumes the
 * tasteProfile derived value separately.
 */

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";

const BASE_RADIUS = 0.02;
/** Time constant for the position ease — ~800 ms to traverse 80% of the
 *  remaining distance toward the target. Frame-rate independent via dt. */
const EASE_TIME_S = 0.8;

export function NorthStar() {
  const { shelfCentroid } = useNebula();
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  // Animated position. Initialised lazily on first non-null shelfCentroid
  // so the marker spawns at the centroid (snap), then eases on subsequent
  // changes.
  const currentPosRef = useRef<THREE.Vector3 | null>(null);

  useFrame((_, dt) => {
    if (!groupRef.current || !coreRef.current || !haloRef.current) return;
    if (!shelfCentroid) return;

    // Lazy snap on first observation, ease afterward.
    if (currentPosRef.current === null) {
      currentPosRef.current = new THREE.Vector3(
        shelfCentroid[0],
        shelfCentroid[1],
        shelfCentroid[2],
      );
    } else {
      const target = shelfCentroid;
      // Exponential decay toward target — frame-rate independent.
      // alpha = 1 - exp(-dt / EASE_TIME_S) reaches ~63% in EASE_TIME_S.
      const alpha = 1 - Math.exp(-dt / EASE_TIME_S);
      currentPosRef.current.x += (target[0] - currentPosRef.current.x) * alpha;
      currentPosRef.current.y += (target[1] - currentPosRef.current.y) * alpha;
      currentPosRef.current.z += (target[2] - currentPosRef.current.z) * alpha;
    }
    groupRef.current.position.copy(currentPosRef.current);

    // Soft pulse — same curve as the previous TasteMarker.
    const t = performance.now() / 1000;
    coreRef.current.scale.setScalar(1 + 0.08 * Math.sin(t * 0.8));
    haloRef.current.scale.setScalar(1 + 0.15 * Math.sin(t * 0.8));
  });

  if (!shelfCentroid) return null;

  return (
    <group ref={groupRef} renderOrder={3}>
      {/* Outer glow halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[BASE_RADIUS * 2.2, 16, 12]} />
        <meshBasicMaterial
          color="#FFD700"
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Core */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[BASE_RADIUS, 20, 14]} />
        <meshStandardMaterial
          color="#FFD700"
          emissive="#FFD700"
          emissiveIntensity={0.8}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
