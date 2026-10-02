// Runs csvx-spec/tests/import-csv/*.json verbatim (operation "csv-to-csvx") against real CSV
// fixtures, writes each result as a real package, and validates it with csvx-spec/validator
// (csvx-spec/AGENTS.md rules 3.2, 3.4, 3.7). Mirrors csvx-go's csv_import_vectors_test.go.

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CSVSyntaxError, importCSV, literalType, resolveCellValue, stringifyCSV } from "../index.js";
import { importCSVFile, openPackage, writePackage } from "../node.js";

const execFileAsync = promisify(execFile);
const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const VECTORS = path.join(SPEC_ROOT, "tests", "import-csv");
const VALIDATOR_BIN = path.join(SPEC_ROOT, "validator", "bin", "csvx-validate.mjs");

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

const haveVectors = await exists(VECTORS);
const haveValidator = await exists(path.join(SPEC_ROOT, "validator", "node_modules"));

interface Vector {
  id: string;
  input: { file: string; options: { delimiter?: string; header?: boolean; infer?: boolean; name?: string } };
  expected: {
    error?: boolean;
    line?: number;
    schemaValid?: boolean;
    sheet?: { id: string; name: string };
    columns?: { id: string; name: string; type?: string }[];
    csv?: string;
    cells?: { cell: string; type: string; value?: string }[];
    noFormulas?: boolean;
    warnings?: { location: string }[];
  };
}

function parseA1(ref: string): { column: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(ref) as RegExpExecArray;
  let column = 0;
  for (const letter of match[1] as string) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) };
}

const vectorFiles = haveVectors ? (await readdir(VECTORS)).filter((name) => name.endsWith(".json")).sort() : [];

describe.skipIf(!haveVectors)("csvx-spec/tests/import-csv vectors", () => {
  it("finds vectors", () => expect(vectorFiles.length).toBeGreaterThan(0));

  for (const file of vectorFiles) {
    it(file, async () => {
      const vector = JSON.parse(await readFile(path.join(VECTORS, file), "utf8")) as Vector;
      const e = vector.expected;
      const source = path.join(SPEC_ROOT, vector.input.file);

      if (e.error) {
        const failure = await importCSVFile(source, vector.input.options).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure, "import should fail").toBeDefined();
        if (e.line) expect((failure as CSVSyntaxError).line).toBe(e.line);
        return;
      }

      const { workbook, warnings } = await importCSVFile(source, vector.input.options);
      const out = path.join(await mkdtemp(path.join(tmpdir(), "csvx-import-")), "out.csvx");
      await writePackage(workbook, out);
      const loaded = await openPackage(out);
      const sheet = loaded.sheets[0]!;

      if (e.sheet) expect({ id: sheet.id, name: sheet.name }).toEqual(e.sheet);
      if (e.columns) {
        expect(sheet.columns.map((c) => ({ id: c.id, name: c.name, type: c.type }))).toEqual(
          e.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
        );
      }
      if (e.csv !== undefined) {
        expect(stringifyCSV(sheet.columns.map((c) => c.name ?? ""), sheet.records)).toBe(e.csv);
      }
      for (const cell of e.cells ?? []) {
        const { column, row } = parseA1(cell.cell);
        const resolved = resolveCellValue(sheet.records[row - 2]?.[column], sheet.columns[column]?.type);
        expect(resolved.type, cell.cell).toBe(cell.type);
        if (cell.value !== undefined) expect(String((resolved as { value?: unknown }).value), cell.cell).toBe(cell.value);
      }
      if (e.noFormulas) {
        for (const meta of Object.values(sheet.cells ?? {})) expect(meta.formula).toBeUndefined();
      }
      if (e.warnings) expect(warnings.map((w) => ({ location: w.location }))).toEqual(e.warnings);
      if (e.schemaValid && haveValidator) {
        await execFileAsync("node", [VALIDATOR_BIN, out], { cwd: path.join(SPEC_ROOT, "validator") });
      }
    });
  }
});

describe("literalType (spec/04-data-types.md Literal forms)", () => {
  const cases: Record<string, string> = {
    "": "blank", true: "boolean", TRUE: "string", " true": "string",
    "0": "integer", "-5": "integer", "007": "string", "+5": "string", "-0": "string", "1e3": "string",
    "19.95": "decimal", "0.5": "decimal", "-0.5": "decimal", "00.5": "string", ".5": "string", "5.": "string", "1,000": "string", $5: "string",
    "2026-09-22": "date", "2026-02-30": "string", "13:45:00": "time", "25:00:00": "string",
    "2026-09-22T12:30:00Z": "datetime", "2026-09-22T12:30:00": "string", "1/2/2026": "string",
  };
  for (const [text, want] of Object.entries(cases)) {
    it(JSON.stringify(text), () => expect(literalType(text)).toBe(want));
  }
});

describe("importCSV edge cases", () => {
  it("handles BOM, semicolon delimiter, and CRLF", () => {
    const { workbook } = importCSV("﻿a;b\r\n1;2\r\n", { delimiter: ";" });
    expect(workbook.sheets[0]!.columns.map((c) => c.name)).toEqual(["a", "b"]);
    expect(workbook.sheets[0]!.records).toEqual([["1", "2"]]);
  });
  it("rejects invalid UTF-8 and bad sheet names", () => {
    expect(() => importCSV(new Uint8Array([0x61, 0x0a, 0xff, 0x0a]))).toThrow(/UTF-8/);
    expect(() => importCSV("a\n", { name: "a:b" })).toThrow(/sheet name/);
  });
  it("reports a stray quote with its line", () => {
    expect(() => importCSV('a,b\n1,x"y\n')).toThrow(CSVSyntaxError);
  });
  it("preserves embedded newlines, quotes and leading zeros exactly", () => {
    const { workbook } = importCSV('a,b\n"x\r\ny ""q""",007\n');
    expect(workbook.sheets[0]!.records).toEqual([['x\ny "q"', "007"]]);
  });
});
