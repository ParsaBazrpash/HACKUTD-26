import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Topology } from "topojson-specification";
import { US_TILES } from "@/components/incidents/blast-radius-model";
import { POSTAL_CODES } from "@/lib/geo/fips";
import {
  buildLandSurface,
  buildStateSurfaces,
  focusDistance,
  HOME_VIEW,
  lonLatToXYZ,
  pointInTriangle,
  polygonTriangles,
  xyzToView,
} from "@/lib/geo/sphere";

function topology(name: string): Topology {
  return JSON.parse(readFileSync(new URL(`../../public/geo/${name}`, import.meta.url), "utf8")) as Topology;
}

function radiusRange(positions: Float32Array): { min: number; max: number; finite: boolean } {
  let min = Infinity;
  let max = 0;
  let finite = true;
  for (let index = 0; index < positions.length; index += 3) {
    const radius = Math.hypot(positions[index], positions[index + 1], positions[index + 2]);
    if (!Number.isFinite(radius)) finite = false;
    if (radius < min) min = radius;
    if (radius > max) max = radius;
  }
  return { min, max, finite };
}

describe("exposure globe geometry", () => {
  const states = buildStateSurfaces(topology("states-10m.json"));
  const land = buildLandSurface(topology("land-110m.json"));

  test("the postal codes are the 50 states and DC, matching the incident grid", () => {
    expect(new Set(POSTAL_CODES).size).toBe(51);
    expect(new Set(POSTAL_CODES)).toEqual(new Set(Object.keys(US_TILES)));
  });

  test("every state and DC has a mesh, and no territory is invented", () => {
    expect(states.map((state) => state.code).sort()).toEqual([...POSTAL_CODES].sort());
    for (const state of states) {
      expect(state.positions.length).toBeGreaterThan(0);
      expect(state.positions.length % 3).toBe(0);
      expect(state.indices.length).toBe(state.positions.length / 3);
      expect(state.outline.length).toBeGreaterThan(6);
      const range = radiusRange(state.positions);
      expect(range.finite, state.code).toBe(true);
      expect(range.min, state.code).toBeGreaterThan(1);
      expect(range.max, state.code).toBeLessThan(1.03);
    }
  });

  test("state triangles stay on the surface and do not jump across the globe", () => {
    for (const state of states) {
      const positions = state.positions;
      for (let index = 0; index < positions.length; index += 9) {
        for (const [a, b] of [
          [0, 3],
          [3, 6],
          [6, 0],
        ] as const) {
          const ax = positions[index + a];
          const ay = positions[index + a + 1];
          const az = positions[index + a + 2];
          const bx = positions[index + b];
          const by = positions[index + b + 1];
          const bz = positions[index + b + 2];
          const dot = ax * bx + ay * by + az * bz;
          const denom = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
          const angle = (Math.acos(Math.min(1, Math.max(-1, dot / denom))) * 180) / Math.PI;
          expect(angle, state.code).toBeLessThan(12);
        }
      }
    }
  });

  test("Alaska and Hawaii keep their real positions", () => {
    const alaska = states.find((state) => state.code === "AK");
    const hawaii = states.find((state) => state.code === "HI");
    expect(alaska).toBeDefined();
    expect(hawaii).toBeDefined();
    expect(alaska!.lat).toBeGreaterThan(50);
    expect(alaska!.lon).toBeLessThan(-130);
    expect(hawaii!.lat).toBeGreaterThan(18);
    expect(hawaii!.lat).toBeLessThan(24);
    expect(hawaii!.lon).toBeLessThan(-154);
    expect(hawaii!.lon).toBeGreaterThan(-161);
  });

  test("a hole stays empty and the surrounding ring is filled", () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const hole: [number, number][] = [
      [4, 4],
      [4, 6],
      [6, 6],
      [6, 4],
    ];
    const tris = polygonTriangles(outer, [hole], 20);
    expect(tris.length).toBeGreaterThan(0);
    expect(tris.some((tri) => pointInTriangle([1, 1], tri))).toBe(true);
    expect(tris.some((tri) => pointInTriangle([5, 5], tri))).toBe(false);
  });

  test("land is a dark sphere mesh, not a flat sketch", () => {
    const range = radiusRange(land.positions);
    expect(land.positions.length).toBeGreaterThan(3_000);
    expect(range.finite).toBe(true);
    expect(range.min).toBeGreaterThan(0.99);
    expect(range.max).toBeLessThan(1.02);
  });

  test("the home view round-trips through the sphere", () => {
    const [x, y, z] = lonLatToXYZ(HOME_VIEW.lon, HOME_VIEW.lat, HOME_VIEW.distance);
    const view = xyzToView(x, y, z);
    expect(view.lon).toBeCloseTo(HOME_VIEW.lon, 4);
    expect(view.lat).toBeCloseTo(HOME_VIEW.lat, 4);
    expect(view.distance).toBeCloseTo(HOME_VIEW.distance, 4);
    expect(focusDistance(1)).toBeLessThan(focusDistance(30));
    expect(focusDistance(Number.NaN)).toBeGreaterThan(1);
  });
});
