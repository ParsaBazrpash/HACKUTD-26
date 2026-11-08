// Geographic meshes for the exposure globe.
//
// State lines are us-atlas 3 `states-10m` (US Census cartographic boundaries, public domain).
// Land is world-atlas 2 `land-110m` (Natural Earth, public domain).
// Both are TopoJSON in longitude/latitude. Nothing here is an incident record.

import { geoArea, geoBounds, geoCentroid, geoDistance, geoInterpolate } from "d3-geo";
import earcut from "earcut";
import { feature } from "topojson-client";
import type { FeatureCollection, GeoJsonProperties, GeometryObject, MultiPolygon, Polygon, Position } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { FIPS_TO_POSTAL } from "@/lib/geo/fips";

const FILL_RADIUS = 1.012;
const LINE_RADIUS = 1.02;
const LAND_RADIUS = 1.002;
const GRATICULE_RADIUS = 0.994;

/** Continental US. Distance is two zoom-in steps (0.8 each) from the first framing. */
export const HOME_VIEW = { lon: -96.5, lat: 38.5, distance: 2.1 } as const;
export const MIN_DISTANCE = 1.45;
export const MAX_DISTANCE = 6.4;

type LonLat = [number, number];
type Tri = [LonLat, LonLat, LonLat];

export interface StateSurface {
  code: string;
  lon: number;
  lat: number;
  /** Degrees across the largest polygon. Used to choose a focus distance. */
  span: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  outline: Float32Array;
}

export interface LandSurface {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface GlobeSurfaces {
  states: StateSurface[];
  land: LandSurface;
  graticule: Float32Array;
}

/** Y-up sphere. Longitude 0, latitude 0 faces +Z. North is +Y. */
export function lonLatToXYZ(lon: number, lat: number, radius: number): [number, number, number] {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return [radius * cosPhi * Math.sin(lambda), radius * Math.sin(phi), radius * cosPhi * Math.cos(lambda)];
}

export function xyzToView(x: number, y: number, z: number): { lon: number; lat: number; distance: number } {
  const distance = Math.hypot(x, y, z) || 1;
  const lat = (Math.asin(Math.min(1, Math.max(-1, y / distance))) * 180) / Math.PI;
  const lon = (Math.atan2(x, z) * 180) / Math.PI;
  return { lon, lat, distance };
}

export function focusDistance(span: number): number {
  const clamped = Number.isFinite(span) ? Math.min(70, Math.max(0, span)) : 8;
  return Math.min(2.55, Math.max(1.62, 1.5 + clamped * 0.026));
}

function pair(position: Position): LonLat | null {
  const lon = position[0];
  const lat = position[1];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function dedupe(ring: readonly Position[]): LonLat[] {
  const out: LonLat[] = [];
  for (const position of ring) {
    const next = pair(position);
    if (!next) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - next[0]) < 1e-7 && Math.abs(prev[1] - next[1]) < 1e-7) continue;
    out.push(next);
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) out.pop();
  }
  return out;
}

/** Make a ring continuous in longitude so a date-line crossing does not span the whole map. */
function unwrap(ring: readonly LonLat[]): LonLat[] {
  if (ring.length === 0) return [];
  const out: LonLat[] = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0] + offset;
    const delta = lon - out[i - 1][0];
    if (delta > 180) {
      offset -= 360;
      lon -= 360;
    } else if (delta < -180) {
      offset += 360;
      lon += 360;
    }
    out.push([lon, ring[i][1]]);
  }
  return out;
}

function meanLon(ring: readonly LonLat[]): number {
  if (ring.length === 0) return 0;
  let sum = 0;
  for (const point of ring) sum += point[0];
  return sum / ring.length;
}

function align(ring: readonly LonLat[], center: number): LonLat[] {
  const unwrapped = unwrap(ring);
  let shift = 0;
  const mean = meanLon(unwrapped);
  while (mean + shift - center > 180) shift -= 360;
  while (mean + shift - center < -180) shift += 360;
  if (shift === 0) return unwrapped;
  return unwrapped.map(([lon, lat]) => [lon + shift, lat]);
}

function planarArea(tri: Tri): number {
  const [a, b, c] = tri;
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) * 0.5;
}

function subdivide(tris: Tri[], maxEdge: number): Tri[] {
  const out: Tri[] = [];
  const stack: { tri: Tri; depth: number }[] = tris.map((tri) => ({ tri, depth: 0 }));
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) break;
    const { tri, depth } = item;
    const d01 = Math.hypot(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1]);
    const d12 = Math.hypot(tri[2][0] - tri[1][0], tri[2][1] - tri[1][1]);
    const d20 = Math.hypot(tri[0][0] - tri[2][0], tri[0][1] - tri[2][1]);
    const max = Math.max(d01, d12, d20);
    if (max <= maxEdge || depth >= 8 || out.length + stack.length > 180_000) {
      if (planarArea(tri) > 1e-8) out.push(tri);
      continue;
    }
    let i = 0;
    let j = 1;
    let k = 2;
    if (d12 >= d01 && d12 >= d20) {
      i = 1;
      j = 2;
      k = 0;
    } else if (d20 >= d01 && d20 >= d12) {
      i = 2;
      j = 0;
      k = 1;
    }
    const mid: LonLat = [(tri[i][0] + tri[j][0]) / 2, (tri[i][1] + tri[j][1]) / 2];
    stack.push({ tri: [tri[i], mid, tri[k]], depth: depth + 1 });
    stack.push({ tri: [mid, tri[j], tri[k]], depth: depth + 1 });
  }
  return out;
}

/** Triangulate an outer ring and its holes. Coordinates may be unwrapped past +/-180. */
export function polygonTriangles(outer: readonly LonLat[], holes: readonly (readonly LonLat[])[], maxEdge = 4): Tri[] {
  if (outer.length < 3) return [];
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const [lon, lat] of outer) flat.push(lon, lat);
  for (const hole of holes) {
    if (hole.length < 3) continue;
    holeIndices.push(flat.length / 2);
    for (const [lon, lat] of hole) flat.push(lon, lat);
  }
  const indices = earcut(flat, holeIndices.length > 0 ? holeIndices : null, 2);
  const tris: Tri[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [0, 1, 2].map((offset) => {
      const vertex = indices[i + offset] * 2;
      return [flat[vertex], flat[vertex + 1]] as LonLat;
    }) as Tri;
    if (planarArea(tri) > 1e-10) tris.push(tri);
  }
  return subdivide(tris, maxEdge);
}

function polygonsOf(geometry: Polygon | MultiPolygon): Position[][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function meshFromTriangles(tris: readonly Tri[], radius: number): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const positions = new Float32Array(tris.length * 9);
  const normals = new Float32Array(tris.length * 9);
  const indices = new Uint32Array(tris.length * 3);
  let vertex = 0;
  for (const tri of tris) {
    for (const [lon, lat] of tri) {
      const [x, y, z] = lonLatToXYZ(lon, lat, radius);
      const length = Math.hypot(x, y, z) || 1;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      normals[offset] = x / length;
      normals[offset + 1] = y / length;
      normals[offset + 2] = z / length;
      indices[vertex] = vertex;
      vertex += 1;
    }
  }
  return { positions, normals, indices };
}

function outlineOf(rings: readonly (readonly LonLat[])[], radius: number): Float32Array {
  const points: number[] = [];
  for (const ring of rings) {
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length; i++) {
      const start = ring[i];
      const end = ring[(i + 1) % ring.length];
      const degrees = geoDistance(start, end) * (180 / Math.PI);
      const steps = Math.max(1, Math.ceil(degrees / 2));
      const interpolate = geoInterpolate(start, end);
      let previous = start;
      for (let step = 1; step <= steps; step++) {
        const next = step === steps ? end : (interpolate(step / steps) as LonLat);
        points.push(...lonLatToXYZ(previous[0], previous[1], radius), ...lonLatToXYZ(next[0], next[1], radius));
        previous = next;
      }
    }
  }
  return new Float32Array(points);
}

function triangulateGeometry(geometry: Polygon | MultiPolygon, maxEdge: number): { tris: Tri[]; rings: LonLat[][] } {
  const tris: Tri[] = [];
  const rings: LonLat[][] = [];
  for (const polygon of polygonsOf(geometry)) {
    const cleaned = polygon.map(dedupe).filter((ring) => ring.length >= 3);
    if (cleaned.length === 0) continue;
    rings.push(...cleaned);
    const outer = unwrap(cleaned[0]);
    const center = meanLon(outer);
    const holes = cleaned.slice(1).map((ring) => align(ring, center));
    tris.push(...polygonTriangles(outer, holes, maxEdge));
  }
  return { tris, rings };
}

function largestPolygon(geometry: Polygon | MultiPolygon): Position[][] | null {
  let best: Position[][] | null = null;
  let bestArea = -1;
  for (const polygon of polygonsOf(geometry)) {
    const area = Math.abs(geoArea({ type: "Polygon", coordinates: polygon }));
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return best;
}

function focusOf(geometry: Polygon | MultiPolygon): { lon: number; lat: number; span: number } | null {
  const polygon = largestPolygon(geometry);
  if (!polygon) return null;
  const shape = { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: polygon } };
  const [lon, lat] = geoCentroid(shape);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const [[west, south], [east, north]] = geoBounds(shape);
  let width = east - west;
  if (width > 180) width = 360 - width;
  const span = Math.min(70, Math.max(width, north - south));
  return { lon, lat, span: Number.isFinite(span) ? span : 8 };
}

function postalCode(id: string | number | undefined): string | null {
  if (id === undefined) return null;
  const fips = String(id).padStart(2, "0");
  return FIPS_TO_POSTAL[fips] ?? null;
}

function asPolygon(geometry: GeometryObject | null): Polygon | MultiPolygon | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return geometry;
  return null;
}

export function buildStateSurfaces(topology: Topology): StateSurface[] {
  const collection = feature(topology, topology.objects.states as GeometryCollection) as FeatureCollection;
  const surfaces: StateSurface[] = [];
  for (const item of collection.features) {
    const code = postalCode(item.id as string | number | undefined);
    const geometry = asPolygon(item.geometry);
    if (!code || !geometry) continue;
    const focus = focusOf(geometry);
    const { tris, rings } = triangulateGeometry(geometry, 3.5);
    if (!focus || tris.length === 0) continue;
    const mesh = meshFromTriangles(tris, FILL_RADIUS);
    surfaces.push({
      code,
      lon: focus.lon,
      lat: focus.lat,
      span: focus.span,
      ...mesh,
      outline: outlineOf(rings, LINE_RADIUS),
    });
  }
  surfaces.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return surfaces;
}

export function buildLandSurface(topology: Topology): LandSurface {
  const collection = feature(topology, topology.objects.land as GeometryCollection) as FeatureCollection<GeometryObject, GeoJsonProperties>;
  const tris: Tri[] = [];
  for (const item of collection.features) {
    const geometry = asPolygon(item.geometry);
    if (!geometry) continue;
    tris.push(...triangulateGeometry(geometry, 8).tris);
  }
  const mesh = meshFromTriangles(tris, LAND_RADIUS);
  return mesh;
}

export function buildGraticule(step = 30): Float32Array {
  const points: number[] = [];
  const segments = 72;
  for (let lon = -180; lon < 180; lon += step) {
    for (let index = 0; index < segments; index++) {
      const lat0 = -75 + (150 * index) / segments;
      const lat1 = -75 + (150 * (index + 1)) / segments;
      points.push(...lonLatToXYZ(lon, lat0, GRATICULE_RADIUS), ...lonLatToXYZ(lon, lat1, GRATICULE_RADIUS));
    }
  }
  for (let lat = -60; lat <= 60; lat += step) {
    for (let index = 0; index < segments; index++) {
      const lon0 = -180 + (360 * index) / segments;
      const lon1 = -180 + (360 * (index + 1)) / segments;
      points.push(...lonLatToXYZ(lon0, lat, GRATICULE_RADIUS), ...lonLatToXYZ(lon1, lat, GRATICULE_RADIUS));
    }
  }
  return new Float32Array(points);
}

let cached: Promise<GlobeSurfaces> | null = null;

async function readTopology(path: string): Promise<Topology> {
  const response = await fetch(path);
  if (!response.ok) throw new Error("boundary file unavailable");
  return (await response.json()) as Topology;
}

/** Load and build once per page. The files are static and contain no incident data. */
export function loadGlobeSurfaces(): Promise<GlobeSurfaces> {
  if (typeof fetch !== "function") return Promise.reject(new Error("boundary file unavailable"));
  if (!cached) {
    cached = Promise.all([readTopology("/geo/states-10m.json"), readTopology("/geo/land-110m.json")])
      .then(([states, land]) => ({
        states: buildStateSurfaces(states),
        land: buildLandSurface(land),
        graticule: buildGraticule(),
      }))
      .catch((error: unknown) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

export function pointInTriangle(point: LonLat, tri: Tri): boolean {
  const [a, b, c] = tri;
  const d1 = (point[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (point[1] - b[1]);
  const d2 = (point[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (point[1] - c[1]);
  const d3 = (point[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (point[1] - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
