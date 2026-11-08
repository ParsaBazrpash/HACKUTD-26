"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { geoInterpolate } from "d3-geo";
import { useSyncExternalStore } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { exposureBand, BAND_FILL } from "@/lib/geo/exposure";
import {
  focusDistance,
  HOME_VIEW,
  loadGlobeSurfaces,
  lonLatToXYZ,
  MAX_DISTANCE,
  MIN_DISTANCE,
  xyzToView,
  type GlobeSurfaces,
  type StateSurface,
} from "@/lib/geo/sphere";

export interface ExposureGlobeHandle {
  zoom: (factor: number) => void;
  reset: () => void;
}

export interface ExposureCounts {
  exposed: number;
  other: number;
}

interface View {
  lon: number;
  lat: number;
  distance: number;
}

interface Flight {
  from: View;
  to: View;
  start: number;
  dur: number;
  pin: boolean;
  interpolate: (t: number) => [number, number];
}

const HOME: View = { lon: HOME_VIEW.lon, lat: HOME_VIEW.lat, distance: HOME_VIEW.distance };
const IDLE_MS = 2800;

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function usePixelRatio(): number {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(max-width: 767px)");
      media.addEventListener("change", notify);
      window.addEventListener("resize", notify);
      return () => {
        media.removeEventListener("change", notify);
        window.removeEventListener("resize", notify);
      };
    },
    () => (window.matchMedia("(max-width: 767px)").matches ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)),
    () => 1,
  );
}

function clampDistance(distance: number): number {
  if (!Number.isFinite(distance)) return HOME.distance;
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, distance));
}

function surfaceGeometry(positions: Float32Array, normals: Float32Array, indices: Uint32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function lineGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function Ocean() {
  return (
    <mesh raycast={() => null}>
      <sphereGeometry args={[0.992, 64, 48]} />
      <meshStandardMaterial color="#070908" roughness={0.94} metalness={0.02} />
    </mesh>
  );
}

function Land({ surface }: { surface: GlobeSurfaces["land"] }) {
  const geometry = useMemo(
    () => surfaceGeometry(surface.positions, surface.normals, surface.indices),
    [surface],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial color="#121614" roughness={1} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        toneMapped: false,
        uniforms: {},
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vNormal = normalize(mat3(modelMatrix) * normal);
            vView = normalize(cameraPosition - world.xyz);
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0), 3.1);
            gl_FragColor = vec4(0.82, 0.98, 0.48, rim * 0.42);
          }
        `,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh scale={1.035} material={material} raycast={() => null} renderOrder={4}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}

function StateMesh({
  surface,
  exposed,
  other,
  hovered,
  selected,
  reduced,
  onHover,
  onSelect,
}: {
  surface: StateSurface;
  exposed: number;
  other: number;
  hovered: boolean;
  selected: boolean;
  reduced: boolean;
  onHover: (code: string | null, clientX: number, clientY: number) => void;
  onSelect: (code: string) => void;
}) {
  const fillRef = useRef<THREE.MeshStandardMaterial>(null);
  const lineRef = useRef<THREE.LineBasicMaterial>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const geometry = useMemo(
    () => surfaceGeometry(surface.positions, surface.normals, surface.indices),
    [surface],
  );
  const outline = useMemo(() => lineGeometry(surface.outline), [surface]);
  useEffect(
    () => () => {
      geometry.dispose();
      outline.dispose();
    },
    [geometry, outline],
  );

  const band = exposureBand(exposed, other);
  const fillTarget = useMemo(() => {
    const color = new THREE.Color(BAND_FILL[band]);
    if (hovered || selected) color.lerp(new THREE.Color("#e7ffb0"), hovered ? 0.2 : 0.12);
    return color;
  }, [band, hovered, selected]);
  const lineTarget = useMemo(
    () => new THREE.Color(hovered || selected ? "#d8ff65" : exposed > 0 || other > 0 ? "#6a7560" : "#465046"),
    [hovered, selected, exposed, other],
  );
  const glow = hovered ? 0.14 : selected ? 0.2 : 0;

  useFrame((_, delta) => {
    const step = reduced ? 1 : 1 - Math.exp(-8 * Math.min(delta, 0.05));
    const fill = fillRef.current;
    const line = lineRef.current;
    if (fill) {
      fill.color.lerp(fillTarget, step);
      fill.emissiveIntensity += (glow - fill.emissiveIntensity) * step;
    }
    if (line) line.color.lerp(lineTarget, step);
  });

  function pointerDown(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation();
    down.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY };
  }

  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation();
    const start = down.current;
    if (!start || event.nativeEvent.button !== 0) return;
    const dx = event.nativeEvent.clientX - start.x;
    const dy = event.nativeEvent.clientY - start.y;
    if (dx * dx + dy * dy > 25) return;
    onSelect(surface.code);
  }

  return (
    <group>
      <mesh
        geometry={geometry}
        renderOrder={1}
        onPointerDown={pointerDown}
        onPointerOver={(event) => {
          event.stopPropagation();
          const gl = event.nativeEvent.target;
          if (gl instanceof HTMLElement) gl.style.cursor = "pointer";
          onHover(surface.code, event.nativeEvent.clientX, event.nativeEvent.clientY);
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          onHover(surface.code, event.nativeEvent.clientX, event.nativeEvent.clientY);
        }}
        onPointerOut={(event) => {
          const gl = event.nativeEvent.target;
          if (gl instanceof HTMLElement) gl.style.cursor = "";
          onHover(null, event.nativeEvent.clientX, event.nativeEvent.clientY);
        }}
        onClick={click}
      >
        <meshStandardMaterial
          ref={fillRef}
          color="#1a201c"
          emissive="#d8ff65"
          emissiveIntensity={0}
          roughness={0.9}
          metalness={0.03}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <lineSegments geometry={outline} renderOrder={2} raycast={() => null}>
        <lineBasicMaterial ref={lineRef} color="#465046" toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function Rig({
  apiRef,
  surfaces,
  selectedCode,
  reduced,
}: {
  apiRef: { current: ExposureGlobeHandle | null };
  surfaces: GlobeSurfaces | null;
  selectedCode: string | null;
  reduced: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useRef<OrbitControlsImpl>(null);
  const flight = useRef<Flight | null>(null);
  const dragging = useRef(false);
  const pinned = useRef(false);
  const idleUntil = useRef(0);
  const flyRef = useRef<(to: View, pin: boolean, dur?: number) => void>(() => {});

  useEffect(() => {
    flyRef.current = (to, pin, dur = 880) => {
      const view = xyzToView(camera.position.x, camera.position.y, camera.position.z);
      const from: View = { lon: view.lon, lat: view.lat, distance: clampDistance(view.distance) };
      flight.current = {
        from,
        to: { ...to, distance: clampDistance(to.distance) },
        start: performance.now(),
        dur: reduced ? 0 : dur,
        pin,
        interpolate: geoInterpolate([from.lon, from.lat], [to.lon, to.lat]),
      };
    };
    apiRef.current = {
      zoom: (factor) => {
        const view = xyzToView(camera.position.x, camera.position.y, camera.position.z);
        const from: View = { lon: view.lon, lat: view.lat, distance: clampDistance(view.distance) };
        flyRef.current({ ...from, distance: from.distance * factor }, pinned.current, 420);
      },
      reset: () => {
        pinned.current = false;
        flyRef.current(HOME, false, 760);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, camera, reduced]);

  useEffect(() => {
    idleUntil.current = performance.now() + 1600;
  }, []);

  useEffect(() => {
    if (!selectedCode || !surfaces) return;
    const state = surfaces.states.find((item) => item.code === selectedCode);
    if (!state) return;
    pinned.current = true;
    flyRef.current({ lon: state.lon, lat: state.lat, distance: focusDistance(state.span) }, true, 920);
  }, [selectedCode, surfaces]);

  useEffect(() => {
    const element = gl.domElement;
    function down(event: PointerEvent) {
      if (event.button !== 0) return;
      dragging.current = true;
      pinned.current = false;
      flight.current = null;
      if (controls.current) controls.current.enabled = true;
    }
    function up() {
      dragging.current = false;
      idleUntil.current = performance.now() + IDLE_MS;
    }
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
    };
  }, [gl]);

  useFrame(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const anim = flight.current;
    if (anim) {
      orbit.enabled = false;
      const now = performance.now();
      const t = anim.dur <= 0 ? 1 : Math.min(1, (now - anim.start) / anim.dur);
      const eased = anim.dur <= 0 ? 1 : 1 - (1 - t) ** 3;
      const point = anim.interpolate(eased);
      const distance = anim.from.distance + (anim.to.distance - anim.from.distance) * eased;
      const [x, y, z] = lonLatToXYZ(point[0], point[1], distance);
      camera.position.set(x, y, z);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      orbit.autoRotate = false;
      if (t >= 1) {
        pinned.current = anim.pin;
        flight.current = null;
        orbit.enabled = true;
        if (!anim.pin) idleUntil.current = performance.now() + 900;
        orbit.update();
      }
      return;
    }
    orbit.autoRotate = !reduced && !dragging.current && !pinned.current && performance.now() >= idleUntil.current;
  });

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.48}
      zoomSpeed={0.65}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={0.28}
      maxPolarAngle={Math.PI - 0.28}
      autoRotateSpeed={0.16}
      target={[0, 0, 0]}
    />
  );
}

function Scene({
  surfaces,
  exposure,
  hoverCode,
  selectedCode,
  reduced,
  onHover,
  onSelect,
  apiRef,
}: {
  surfaces: GlobeSurfaces;
  exposure: Record<string, ExposureCounts>;
  hoverCode: string | null;
  selectedCode: string | null;
  reduced: boolean;
  onHover: (code: string | null, clientX: number, clientY: number) => void;
  onSelect: (code: string) => void;
  apiRef: { current: ExposureGlobeHandle | null };
}) {
  return (
    <>
      <ambientLight intensity={0.64} />
      <directionalLight position={[-5, 3.2, -1]} intensity={1.05} color="#f4f5f0" />
      <directionalLight position={[4, -1.2, 2]} intensity={0.16} color="#c5d0b4" />
      <Ocean />
      <Land surface={surfaces.land} />
      {surfaces.states.map((surface) => {
        const row = exposure[surface.code];
        return (
          <StateMesh
            key={surface.code}
            surface={surface}
            exposed={row?.exposed ?? 0}
            other={row?.other ?? 0}
            hovered={hoverCode === surface.code}
            selected={selectedCode === surface.code}
            reduced={reduced}
            onHover={onHover}
            onSelect={onSelect}
          />
        );
      })}
      <Atmosphere />
      <Rig apiRef={apiRef} surfaces={surfaces} selectedCode={selectedCode} reduced={reduced} />
    </>
  );
}

export const ExposureGlobe = forwardRef<
  ExposureGlobeHandle,
  {
    exposure: Record<string, ExposureCounts>;
    hoverCode: string | null;
    selectedCode: string | null;
    onHover: (code: string | null, clientX: number, clientY: number) => void;
    onSelect: (code: string) => void;
    onUnavailable: () => void;
  }
>(function ExposureGlobe({ exposure, hoverCode, selectedCode, onHover, onSelect, onUnavailable }, ref) {
  const [surfaces, setSurfaces] = useState<GlobeSurfaces | null>(null);
  const api = useRef<ExposureGlobeHandle | null>(null);
  const reduced = useReducedMotion();
  const dpr = usePixelRatio();
  const home = useMemo(() => lonLatToXYZ(HOME.lon, HOME.lat, HOME.distance), []);

  useImperativeHandle(ref, () => ({
    zoom: (factor) => api.current?.zoom(factor),
    reset: () => api.current?.reset(),
  }), []);

  useEffect(() => {
    let live = true;
    loadGlobeSurfaces().then(
      (next) => {
        if (!live) return;
        if (next.states.length < 50) {
          onUnavailable();
          return;
        }
        setSurfaces(next);
      },
      () => {
        if (live) onUnavailable();
      },
    );
    return () => {
      live = false;
    };
  }, [onUnavailable]);

  if (!surfaces) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted" role="status">
        Preparing the exposure map
      </div>
    );
  }

  return (
    <Canvas
      className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
      tabIndex={-1}
      dpr={dpr}
      camera={{ position: home, fov: 32, near: 0.08, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.NoToneMapping;
        gl.domElement.setAttribute(
          "aria-label",
          "United States exposure globe. Drag to turn, scroll to zoom, or choose a state from the list.",
        );
      }}
    >
      <Scene
        surfaces={surfaces}
        exposure={exposure}
        hoverCode={hoverCode}
        selectedCode={selectedCode}
        reduced={reduced}
        onHover={onHover}
        onSelect={onSelect}
        apiRef={api}
      />
    </Canvas>
  );
});
