import { describe, it, expect } from "vitest";
import { allocateDeskIndex } from "./desks.js";

describe("allocateDeskIndex", () => {
  it("returns 0 when no desks are taken", () => {
    expect(allocateDeskIndex([])).toBe(0);
  });

  it("returns the first free index, skipping taken ones", () => {
    expect(allocateDeskIndex([0, 1, 3])).toBe(2);
  });

  it("ignores null desk indexes", () => {
    expect(allocateDeskIndex([0, null, null])).toBe(1);
  });

  it("returns null when all desks are full", () => {
    expect(allocateDeskIndex([0, 1], 2)).toBe(null);
  });
});
