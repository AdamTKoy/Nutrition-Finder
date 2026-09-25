import { describe, expect, it } from "vitest";
import { distanceInMiles } from "./distance";

// boundary examples check both sides of search radius
describe("distanceInMiles", () => {
  it("returns zero for the same location", () => {
    expect(
      distanceInMiles(41.88, -87.62, 41.88, -87.62),
    ).toBe(0);
  });

  it("measures approximately 69.1 miles per degree at the equator", () => {
    expect(distanceInMiles(0, 0, 0, 1)).toBeCloseTo(69.1, 1);
  });

  it("returns the same distance in either direction", () => {
    const forward = distanceInMiles(41.88, -87.62, 41.92, -87.65);
    const backward = distanceInMiles(41.92, -87.65, 41.88, -87.62);

    expect(forward).toBeCloseTo(backward, 10);
  });

  it("measures a point just inside five miles", () => {
    // About 4.97 miles north along a meridian.
    const distance = distanceInMiles(0, 0, 0.072, 0);

    expect(distance).toBeGreaterThan(4.9);
    expect(distance).toBeLessThan(5);
  });

  it("measures a point just outside five miles", () => {
    // About 5.04 miles north along a meridian.
    const distance = distanceInMiles(0, 0, 0.073, 0);

    expect(distance).toBeGreaterThan(5);
    expect(distance).toBeLessThan(5.1);
  });

  it("handles locations across the international date line", () => {
    expect(
      distanceInMiles(0, 179.99, 0, -179.99),
    ).toBeCloseTo(1.382, 2);
  });
});