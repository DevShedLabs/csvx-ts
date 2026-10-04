// Tests the XLSX bridge against the real `csvx` tool and a real fixture (csvx-spec/AGENTS.md rule
// 3.7). The import tests are skipped, not faked, when `csvx` is not installed.
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CSVXCLINotFoundError, exportXLSX, importXLSX, isCSVXCLIAvailable } from "../xlsx.js";

const FIXTURE = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec", "examples", "example.xlsx");
const haveFixture = await stat(FIXTURE).then(() => true, () => false);
const haveCLI = await isCSVXCLIAvailable();

describe("XLSX through the csvx command-line tool", () => {
  it("explains what to do when the tool is missing", async () => {
    await expect(importXLSX(FIXTURE, { cli: "/nonexistent/csvx" })).rejects.toBeInstanceOf(CSVXCLINotFoundError);
    await expect(importXLSX(FIXTURE, { cli: "/nonexistent/csvx" })).rejects.toThrow(/README|XLSX/);
    expect(await isCSVXCLIAvailable({ cli: "/nonexistent/csvx" })).toBe(false);
  });

  it.skipIf(!haveCLI || !haveFixture)("imports a real XLSX into a workbook", async () => {
    const workbook = await importXLSX(FIXTURE);
    expect(workbook.sheets.length).toBeGreaterThan(0);
    expect(workbook.source?.format).toBe("xlsx");
  });

  it.skipIf(!haveCLI || !haveFixture)("recovers the embedded original byte-for-byte", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "csvx-ts-xlsx-test-"));
    const packaged = path.join(dir, "book.csvx");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => execFile("csvx", ["import", FIXTURE, packaged], (e) => (e ? reject(e) : resolve())));
    const out = path.join(dir, "back.xlsx");
    await exportXLSX(packaged, out);
    expect((await readFile(out)).equals(await readFile(FIXTURE))).toBe(true);
  });
});
