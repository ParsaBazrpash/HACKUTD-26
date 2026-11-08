import { describe, expect, test } from "vitest";
import { exposureBand, leadingStatus } from "@/lib/geo/exposure";

describe("exposure bands", () => {
  test("a state with no residents stays neutral", () => {
    expect(exposureBand(0, 0)).toBe("none");
    expect(exposureBand(Number.NaN, 0)).toBe("none");
    expect(exposureBand(-4, 0)).toBe("none");
  });

  test("residents outside the blast radius are not counted as exposure", () => {
    expect(exposureBand(0, 40)).toBe("outside");
  });

  test("the scale follows the resident thresholds already on the record", () => {
    expect(exposureBand(1)).toBe("low");
    expect(exposureBand(249)).toBe("low");
    expect(exposureBand(250)).toBe("moderate");
    expect(exposureBand(999)).toBe("moderate");
    expect(exposureBand(1000)).toBe("high");
    expect(exposureBand(9999)).toBe("high");
    expect(exposureBand(10000)).toBe("critical");
    expect(exposureBand(9800, 10)).toBe("high");
  });

  test("the leading status is the worst one on the record, never an invented one", () => {
    expect(leadingStatus([])).toBeNull();
    expect(leadingStatus(["contained", "exfiltrated", "suspected"])).toBe("exfiltrated");
    expect(leadingStatus(["restored"])).toBe("restored");
    expect(leadingStatus(["not-a-status", "contained"])).toBe("contained");
  });
});
