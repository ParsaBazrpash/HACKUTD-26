// Minimal types for the geographic helpers this repo calls.
// d3-geo 3 ships no declarations, and the globe only needs these five functions.

declare module "d3-geo" {
  export function geoArea(feature: unknown): number;
  export function geoBounds(feature: unknown): [[number, number], [number, number]];
  export function geoCentroid(feature: unknown): [number, number];
  export function geoDistance(a: readonly [number, number], b: readonly [number, number]): number;
  export function geoInterpolate(
    a: readonly [number, number],
    b: readonly [number, number],
  ): (t: number) => [number, number];
}
