"use client";

// react-hooks/immutability flags THREE.js BufferAttribute / typed-array
// mutations (.needsUpdate, setX, direct array writes) when the value
// came from useMemo. THREE objects are mutate-and-flag by design — the
// standard R3F bridge for custom instanced attributes uses this exact
// pattern. Disabled file-wide rather than scattering line-level
// directives that drift between rule firings.
/* eslint-disable react-hooks/immutability */

/**
 * D6 reading-trail comet — short fading gold polyline through the user's
 * three most-recent shelf additions, plus a particle wake from the head
 * book that fires for ~5 seconds whenever a new book is added.
 *
 * Distinct from `NebulaPathLine` (the long-form journey through every
 * read book in chronological order). This is the eye-catching "look
 * what's new on your shelf" comet — short, bright, brief.
 *
 * The particle wake re-uses the D1 `ignitedBook` timestamp instead of
 * tracking its own timer — adding a book fires both D1 (book pulse +
 * cascade) and D6 (trail update + particle burst) on the same signal.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import { bookWorldPos } from "@/lib/nebula/world-scale";

const TRAIL_HEAD_OPACITY = 0.85;
const TRAIL_TAIL_OPACITY = 0.20;
const TRAIL_COLOR = "#FFD700";

const PARTICLE_COUNT = 40;
const PARTICLE_LIFETIME_S = 5;
const PARTICLE_SPEED = 0.05; // world units per second
const PARTICLE_BASE_SIZE_PX = 12;

const particleVertexShader = `
  attribute float age;
  varying float vAge;

  void main() {
    vAge = age;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float life = clamp(age / ${PARTICLE_LIFETIME_S.toFixed(1)}, 0.0, 1.0);
    gl_PointSize = ${PARTICLE_BASE_SIZE_PX.toFixed(2)} * (1.0 + life * 1.5);
  }
`;

const particleFragmentShader = `
  varying float vAge;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float life = clamp(vAge / ${PARTICLE_LIFETIME_S.toFixed(1)}, 0.0, 1.0);
    float alpha = (1.0 - life) * smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(1.0, 0.84, 0.0, alpha * 0.6);
  }
`;

export function ReadingTrail() {
  const { books, recentShelfBooks, ignitedBook, regionAnchorMap, spacingMultiplier } = useNebula();

  // ---------- Polyline through the 3 most-recent additions ----------

  const trailPoints = useMemo(() => {
    const bookById = new Map(books.map((b) => [b.id, b]));
    const pts: THREE.Vector3[] = [];
    for (const s of recentShelfBooks) {
      const b = bookById.get(s.bookId);
      if (!b) continue;
      const [x, y, z] = bookWorldPos(b, regionAnchorMap, spacingMultiplier);
      pts.push(new THREE.Vector3(x, y, z));
    }
    return pts;
  }, [books, recentShelfBooks, regionAnchorMap, spacingMultiplier]);

  // Build up to two line segments (head→middle, middle→tail) so each can
  // carry its own opacity for the fading gradient. Memoised by trailPoints
  // identity so the geometry isn't rebuilt on unrelated re-renders.
  const segments = useMemo(() => {
    const out: { geometry: THREE.BufferGeometry; opacity: number }[] = [];
    for (let i = 0; i < trailPoints.length - 1; i++) {
      const a = trailPoints[i];
      const b = trailPoints[i + 1];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3),
      );
      const t = trailPoints.length <= 2 ? 0 : i / (trailPoints.length - 2);
      const opacity = TRAIL_HEAD_OPACITY + (TRAIL_TAIL_OPACITY - TRAIL_HEAD_OPACITY) * t;
      out.push({ geometry: geo, opacity });
    }
    return out;
  }, [trailPoints]);

  // ---------- Particle wake from the head book ----------

  const positions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
  const velocities = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);
  // Initialise ages past the lifetime so no particles paint before the
  // first ignition event.
  const ages = useMemo(() => {
    const a = new Float32Array(PARTICLE_COUNT);
    a.fill(PARTICLE_LIFETIME_S + 1);
    return a;
  }, []);

  const positionAttr = useMemo(
    () => new THREE.BufferAttribute(positions, 3),
    [positions],
  );
  const ageAttr = useMemo(
    () => new THREE.BufferAttribute(ages, 1),
    [ages],
  );

  const particleMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: particleVertexShader,
        fragmentShader: particleFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  );

  const lastIgnitedAtRef = useRef<number | null>(null);

  useFrame((_, dt) => {
    // Spawn particles once per ignition event — match guard ensures we
    // only respawn when ignitedBook.at flips to a new value.
    if (
      ignitedBook.at != null &&
      ignitedBook.bookId != null &&
      ignitedBook.at !== lastIgnitedAtRef.current
    ) {
      lastIgnitedAtRef.current = ignitedBook.at;
      // The head of the trail is the most-recently-added book — by
      // construction equal to ignitedBook.bookId immediately after add.
      const headBook = books.find((b) => b.id === ignitedBook.bookId);
      if (headBook) {
        const [hx, hy, hz] = bookWorldPos(headBook, regionAnchorMap, spacingMultiplier);
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          positions[i * 3 + 0] = hx;
          positions[i * 3 + 1] = hy;
          positions[i * 3 + 2] = hz;
          // Random unit vector × scaled speed for outward drift.
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const sp = PARTICLE_SPEED * (0.6 + Math.random() * 0.8);
          velocities[i * 3 + 0] = Math.sin(phi) * Math.cos(theta) * sp;
          velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * sp;
          velocities[i * 3 + 2] = Math.cos(phi) * sp;
          ages[i] = 0;
        }
      }
    }

    // Advance live particles. Skip dead ones to keep the loop tight when
    // no add has fired in 5+ seconds.
    let touched = false;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      if (ages[i] >= PARTICLE_LIFETIME_S) continue;
      touched = true;
      ages[i] += dt;
      positions[i * 3 + 0] += velocities[i * 3 + 0] * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
    }
    if (touched) {
      positionAttr.needsUpdate = true;
      ageAttr.needsUpdate = true;
    }
  });

  return (
    <group>
      {segments.map((s, i) => (
        <lineSegments key={i} geometry={s.geometry} renderOrder={2}>
          <lineBasicMaterial
            color={TRAIL_COLOR}
            transparent
            opacity={s.opacity}
            depthWrite={false}
            toneMapped={false}
          />
        </lineSegments>
      ))}

      <points renderOrder={2}>
        <bufferGeometry>
          <primitive object={positionAttr} attach="attributes-position" />
          <primitive object={ageAttr} attach="attributes-age" />
        </bufferGeometry>
        <primitive object={particleMaterial} attach="material" />
      </points>
    </group>
  );
}
