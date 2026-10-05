// Runs csvx-spec/tests/export-csv/export.json and round-trip.json verbatim (operations
// "csvx-to-csv" and "csv-round-trip") — csvx-spec/AGENTS.md rule 3.4. Expected CSV is compared byte
// for byte. via-xlsx.json needs XLSX and is run by csvx-go.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importCSVFile, openDirectory } from "../node.js";
import { exportCSV } from "../index.js";
import type { Workbook } from "../index.js";

const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const DIR = path.join(SPEC_ROOT, "tests", "export-csv");
const have = await stat(DIR).then(() => true, () => false);

async function cases(file: string): Promise<any[]> {
  return have ? JSON.parse(await readFile(path.join(DIR, file), "utf8")).cases : [];
}

describe.skipIf(!have)("csvx-spec/tests/export-csv/export.json (csvx-to-csv)", async () => {
  const list = await cases("export.json");
  it("found vectors", () => expect(list.length).toBeGreaterThan(0));
  it.each(list.map((c) => [c.note, c]))("%s", async (_note, c: any) => {
    const workbook: Workbook = c.input.package
      ? await openDirectory(path.join(SPEC_ROOT, c.input.package))
      : { id: "book", version: "1.0", ...c.input.workbook, sheets: c.input.workbook.sheets.map((s: any) => ({ path: `sheets/${s.id}.csv`, ...s })) };
    if (c.expected.error) {
      expect(() => exportCSV(workbook, c.input.options)).toThrow();
      return;
    }
    const result = exportCSV(workbook, c.input.options);
    expect(result.csv).toBe(c.expected.csv);
    expect(result.warnings.map((w) => ({ feature: w.feature, location: w.location }))).toEqual(c.expected.warnings);
  });
});

describe.skipIf(!have)("csvx-spec/tests/export-csv/round-trip.json (csv-round-trip)", async () => {
  const list = await cases("round-trip.json");
  it("found vectors", () => expect(list.length).toBeGreaterThan(0));
  it.each(list.map((c) => [c.note, c]))("%s", async (_note, c: any) => {
    const { workbook } = await importCSVFile(path.join(SPEC_ROOT, c.input.file), c.input.importOptions);
    expect(exportCSV(workbook).csv).toBe(c.expected.csv);
  });
});
