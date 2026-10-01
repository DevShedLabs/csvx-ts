// Exercises resolveCellValue and nextCellMetadata directly — the two primitives csvx-web was
// reimplementing by hand before a real bug (a stale "type":"blank" override silently eating a
// freshly-typed literal value) showed why that decision has to live in exactly one place. See
// csvx-spec/spec/05-cell-values.md for the invariant these implement.

import { describe, expect, it } from "vitest";
import { nextCellMetadata, resolveCellValue } from "../model.js";

describe("resolveCellValue", () => {
  it("honors a declared type over literal shape", () => {
    expect(resolveCellValue("1", "string")).toEqual({ type: "string", value: "1" });
    expect(resolveCellValue("", "string")).toEqual({ type: "blank" });
  });

  it("infers a basic literal type when nothing is declared", () => {
    expect(resolveCellValue("42")).toEqual({ type: "integer", value: 42 });
    expect(resolveCellValue("19.95")).toEqual({ type: "decimal", value: "19.95" });
    expect(resolveCellValue("true")).toEqual({ type: "boolean", value: true });
    expect(resolveCellValue("hello")).toEqual({ type: "string", value: "hello" });
    expect(resolveCellValue("")).toEqual({ type: "blank" });
  });

  it("never infers past a declared type, even one that produces an error", () => {
    expect(resolveCellValue("not a number", "integer")).toEqual({ type: "error", code: "VALUE" });
  });
});

describe("nextCellMetadata", () => {
  it("drops type, formula, and cached on a literal edit, preserving style/validation", () => {
    const existing = { type: "blank", style: "s4", validation: { type: "whole" } };
    expect(nextCellMetadata(existing)).toEqual({ style: "s4", validation: { type: "whole" } });
  });

  it("returns undefined when nothing is left to keep", () => {
    expect(nextCellMetadata({ type: "blank" })).toBeUndefined();
    expect(nextCellMetadata(undefined)).toBeUndefined();
  });

  it("drops cached and type on a formula edit, keeping style and setting the new formula", () => {
    const existing = { formula: "=A1", cached: { type: "integer", value: 1 }, type: "integer", style: "s1" };
    expect(nextCellMetadata(existing, "=B1+1")).toEqual({ style: "s1", formula: "=B1+1" });
  });

  it("preserves fields this engine doesn't recognize (AGENTS.md rule 3.6)", () => {
    const existing = { type: "blank", vendorExtension: { enabled: true } };
    expect(nextCellMetadata(existing)).toEqual({ vendorExtension: { enabled: true } });
  });
});
