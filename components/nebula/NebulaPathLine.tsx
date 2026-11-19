"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";

export function NebulaPathLine() {
  const { sortedPath, showPath } = useNebula();

  const { tubeGeometry, spherePositions } = useMemo(() => {
    if (!showPath || sortedPath.length < 2) return { tubeGeometry: null, spherePositions: [] };

    const points = sortedPath.map((n) => new THREE.Vector3(n.x, n.y, n.z));
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.5);
    const tube = new THREE.TubeGeometry(curve, sortedPath.length * 8, 0.004, 6, false);

    return { tubeGeometry: tube, spherePositions: points };
  }, [sortedPath, showPath]);

  if (!showPath || !tubeGeometry) return null;

  return (
    <group>
      {/* Golden tube */}
      <mesh geometry={tubeGeometry}>
        <meshStandardMaterial
          color="#F59E0B"
          emissive="#F59E0B"
          emissiveIntensity={0.5}
          transparent
          opacity={0.7}
          toneMapped={false}
        />
      </mesh>

      {/* Glow tube (wider, dimmer) */}
      <mesh geometry={new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(sortedPath.map((n) => new THREE.Vector3(n.x, n.y, n.z)), false, "centripetal", 0.5),
        sortedPath.length * 8, 0.012, 6, false
      )}>
        <meshStandardMaterial
          color="#F59E0B"
          emissive="#F59E0B"
          emissiveIntensity={0.2}
          transparent
          opacity={0.15}
          toneMapped={false}
        />
      </mesh>

      {/* Golden spheres at each node */}
      {spherePositions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.008, 8, 6]} />
          <meshStandardMaterial
            color="#FFD700"
            emissive="#FFD700"
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
