"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useNebula } from "@/lib/nebula/nebula-context";
import type { OrbitControls as OrbitControlsType } from "three-stdlib";

const LERP_SPEED = 0.05;
const ARRIVE_THRESHOLD = 0.03;
const CAMERA_OFFSET = 0.4;

interface CameraControllerProps {
  controlsRef: React.RefObject<OrbitControlsType | null>;
}

export function CameraController({ controlsRef }: CameraControllerProps) {
  const { camera } = useThree();
  const { flyTarget, setFlyTarget, cameraDirectionRef } = useNebula();
  const targetPos = useRef(new THREE.Vector3());
  const isFlying = useRef(false);

  useFrame(() => {
    // Publish camera direction + position + zoom signal to the ref. Zoom is
    // camera-to-target distance — the actual "how zoomed in" measure —
    // rather than camera-to-origin, which inflates spuriously when the user
    // flies to an off-centre cluster.
    camera.getWorldDirection(cameraDirectionRef.current.forward);
    cameraDirectionRef.current.position.copy(camera.position);
    const controlsTarget = controlsRef.current?.target;
    cameraDirectionRef.current.distanceToTarget = controlsTarget
      ? camera.position.distanceTo(controlsTarget)
      : camera.position.length();

    if (!flyTarget) {
      isFlying.current = false;
      return;
    }

    if (!isFlying.current) {
      targetPos.current.set(flyTarget.x, flyTarget.y, flyTarget.z);
      isFlying.current = true;
    }

    // Compute camera destination: offset from target along current view direction.
    // flyTarget can override the offset for wider "home" flights.
    const offset = flyTarget.cameraDistance ?? CAMERA_OFFSET;
    const dir = new THREE.Vector3().subVectors(camera.position, targetPos.current).normalize();
    const dest = targetPos.current.clone().add(dir.multiplyScalar(offset));

    // Lerp camera position
    camera.position.lerp(dest, LERP_SPEED);

    // Update OrbitControls target so it doesn't snap back
    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetPos.current, LERP_SPEED);
      controlsRef.current.update();
    }

    // Check if arrived
    const dist = camera.position.distanceTo(dest);
    if (dist < ARRIVE_THRESHOLD) {
      // Lock final position
      if (controlsRef.current) {
        controlsRef.current.target.copy(targetPos.current);
        controlsRef.current.update();
      }
      isFlying.current = false;
      setFlyTarget(null);
    }
  });

  return null;
}
