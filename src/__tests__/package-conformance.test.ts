// Runs the csvx-spec vectors whose operations are "validate-package" and "round-trip" verbatim
// (csvx-spec/AGENTS.md rule 3.4): tests/parsing, tests/invalid/missing-manifest.json, tests/styles,
// and tests/print/print-settings-preserved.json. Nothing ran these before.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { loadWorkbookFromZip, openDirectory, validate, validateBuffer, writeWorkbookToZip } from "../index.js";
import type { Workbook } from "../index.js";

const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");

async function vectorsWith(operation: string): Promise<any[]> {
  const found: any[] = [];
  for (const dir of ["parsing", "invalid", "styles", "print"]) {
    const base = path.join(SPEC_ROOT, "tests", dir);
    for (const file of (await readdir(base).catch(() => [])).filter((f) => f.endsWith(".json")).sort()) {
      const vector = JSON.parse(await readFile(path.join(base, file), "utf8"));
      if (vector.operation === operation) found.push(vector);
    }
  }
  return found;
}

describe("validate-package vectors", async () => {
  const vectors = await vectorsWith("validate-package");
  it("found vectors", () => expect(vectors.length).toBeGreaterThan(0));
  it.each(vectors)("$id", async (vector) => {
    let result;
    if (typeof vector.input === "string") {
      result = await validate(path.join(SPEC_ROOT, vector.input));
    } else {
      // A package containing only the listed (empty) files.
      const zip = new JSZip();
      for (const name of vector.input.files) zip.file(name, "");
      result = await validateBuffer(await zip.generateAsync({ type: "uint8array" }));
    }
    expect(result.valid).toBe(vector.expected.valid);
    expect(result.errors.map((e) => ({ code: e.code }))).toEqual(vector.expected.errors.map((e: any) => ({ code: e.code })));
  });
});

const baseWorkbook = (extra: Partial<Workbook>): Workbook => ({
  id: "book",
  version: "1.0",
  sheets: [{ id: "sheet-1", name: "Sheet1", path: "sheets/sheet-1.csv", columns: [{ id: "A", name: "A" }], records: [["1"]], cells: {} }],
  ...extra,
});

describe("round-trip vectors", async () => {
  const vectors = await vectorsWith("round-trip");
  it("found vectors", () => expect(vectors.length).toBeGreaterThan(0));
  it.each(vectors)("$id", async (vector) => {
    if (vector.input.style) {
      const loaded = await loadWorkbookFromZip(await writeWorkbookToZip(baseWorkbook({ styles: [vector.input.style] })));
      expect(loaded.styles?.[0]).toEqual(vector.expected.style);
    } else {
      const meta = vector.input.sheetMetadata;
      const columns = meta.columns ?? [{ id: "A", name: "A" }];
      const sheet = { id: "sheet-1", name: meta.name, path: "sheets/sheet-1.csv", columns, records: [columns.map(() => "1")], print: meta.print, cells: meta.cells ?? {}, rowHeights: meta.rowHeights };
      const loaded = await loadWorkbookFromZip(await writeWorkbookToZip({ ...baseWorkbook({}), sheets: [sheet as any] }));
      const first = loaded.sheets[0]!;
      const actual: Record<string, unknown> = { id: first.id, name: first.name, print: first.print, columns: first.columns, rowHeights: first.rowHeights };
      for (const key of Object.keys(vector.expected.sheetMetadata)) expect(actual[key], key).toEqual(vector.expected.sheetMetadata[key]);
    }
  });
});
