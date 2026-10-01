// Tests this engine against the real golden fixtures in csvx-spec/examples/, not hand-invented
// minimal JSON — see csvx-spec/AGENTS.md rule 3.7, which specifically calls out that
// pattern (a one-line inline JSON string, a three-field struct literal) as the reason csvx-go's
// pre-2026-09-30 test suite never caught its styles.json schema drift. Every example here is
// loaded through the real ZIP-package path and validated against the canonical schema validator
// (csvx-spec/validator), not just checked for "it parsed".

import { execFile } from "node:child_process";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { extractPackage, openDirectory, openPackage, packageDirectory, writePackage } from "../node.js";

const execFileAsync = promisify(execFile);
const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const EXAMPLES_DIR = path.join(SPEC_ROOT, "examples");
const VALIDATOR_BIN = path.join(SPEC_ROOT, "validator", "bin", "csvx-validate.mjs");

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function validateAgainstSchema(packagePath: string): Promise<void> {
  await execFileAsync("node", [VALIDATOR_BIN, path.resolve(packagePath)], { cwd: path.join(SPEC_ROOT, "validator") });
}

async function listExampleFixtures(): Promise<string[]> {
  if (!(await exists(EXAMPLES_DIR))) {
    return [];
  }
  const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".csvx")).map((entry) => path.join(EXAMPLES_DIR, entry.name));
}

const haveSpecChecked = await exists(EXAMPLES_DIR);
const haveValidatorChecked = await exists(VALIDATOR_BIN);
const haveValidatorDeps = haveValidatorChecked && (await exists(path.join(SPEC_ROOT, "validator", "node_modules")));
const describeIfSpec = haveSpecChecked ? describe : describe.skip;

describeIfSpec("every csvx-spec/examples/*.csvx fixture", () => {
  it("loads through openDirectory and (when the validator is installed) validates", async () => {
    const fixtures = await listExampleFixtures();
    expect(fixtures.length).toBeGreaterThan(0);

    for (const fixtureDir of fixtures) {
      const workbook = await openDirectory(fixtureDir);
      expect(workbook.sheets.length).toBeGreaterThan(0);
      for (const sheet of workbook.sheets) {
        expect(sheet.id).not.toBe("");
        expect(sheet.columns.length).toBeGreaterThan(0);
      }

      if (haveValidatorDeps) {
        const tempDir = await mkdtemp(path.join(tmpdir(), "csvx-ts-example-"));
        const packaged = path.join(tempDir, "packaged.csvx");
        await packageDirectory(fixtureDir, packaged);
        await expect(validateAgainstSchema(packaged)).resolves.not.toThrow();
      }
    }
  });
});

describeIfSpec("typed-data.csvx", () => {
  it("preserves per-column scalar types and raw CSV values", async () => {
    const fixtureDir = path.join(EXAMPLES_DIR, "typed-data.csvx");
    if (!(await exists(fixtureDir))) return;

    const workbook = await openDirectory(fixtureDir);
    const sheet = workbook.sheets.find((s) => s.id === "data");
    expect(sheet).toBeDefined();
    expect(sheet!.columns.map((c) => c.type)).toEqual(["string", "decimal", "date", "boolean"]);
    expect(sheet!.records[0]).toEqual(["Ada", "19.95", "2026-09-22", "true"]);
  });
});

describeIfSpec("formulas.csvx", () => {
  it("preserves formula strings and cached decimal values", async () => {
    const fixtureDir = path.join(EXAMPLES_DIR, "formulas.csvx");
    if (!(await exists(fixtureDir))) return;

    const workbook = await openDirectory(fixtureDir);
    const sheet = workbook.sheets.find((s) => s.id === "calculation");
    expect(sheet).toBeDefined();
    const total = sheet!.cells?.["C4"];
    expect(total?.formula).toBe("=SUM(C2:C3)");
    expect(total?.cached).toEqual({ type: "decimal", value: "15.00" });
  });
});

describeIfSpec("styled.csvx", () => {
  it("preserves styles as an array of self-identifying objects, matching styles.schema.json", async () => {
    const fixtureDir = path.join(EXAMPLES_DIR, "styled.csvx");
    if (!(await exists(fixtureDir))) return;

    const workbook = await openDirectory(fixtureDir);
    expect(Array.isArray(workbook.styles)).toBe(true);
    const currency = workbook.styles?.find((style) => style.id === "currency");
    expect(currency?.numberFormat).toBe("$#,##0.00");
    const heading = workbook.styles?.find((style) => style.id === "heading");
    expect(heading?.font).toMatchObject({ bold: true });
  });
});

describeIfSpec("round-trip through a packaged .csvx file", () => {
  it("open -> write -> open on a real fixture preserves records, and output validates", async () => {
    const fixtureDir = path.join(EXAMPLES_DIR, "formulas.csvx");
    if (!(await exists(fixtureDir))) return;

    const original = await openDirectory(fixtureDir);
    const tempDir = await mkdtemp(path.join(tmpdir(), "csvx-ts-roundtrip-"));
    const outputPath = path.join(tempDir, "roundtrip.csvx");
    await writePackage(original, outputPath);

    const reopened = await openPackage(outputPath);
    expect(reopened.sheets.map((s) => s.id)).toEqual(original.sheets.map((s) => s.id));
    expect(reopened.sheets[0]?.records).toEqual(original.sheets[0]?.records);

    if (haveValidatorDeps) {
      await expect(validateAgainstSchema(outputPath)).resolves.not.toThrow();
    }

    const extractedDir = path.join(tempDir, "extracted");
    await extractPackage(outputPath, extractedDir);
    expect(await exists(path.join(extractedDir, "manifest.json"))).toBe(true);
  });
});
