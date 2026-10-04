// Applies every chapter 15 edit operation to each golden fixture in csvx-spec/examples/, writes the
// result as a real package, and validates it with the canonical validator (csvx-spec/validator) —
// csvx-spec/AGENTS.md rules 3.2 and 3.7. The conformance vectors compare models; only this proves
// the engine's edited output still conforms to schemas/*.json.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { addSheet, applyStyle, clearStyle, deleteColumns, deleteRows, insertColumns, insertRows, paste, renameSheet, setCell, setPrint } from "../edit.js";
import { openDirectory, openPackage, writePackage } from "../node.js";
import type { Workbook } from "../model.js";

const execFileAsync = promisify(execFile);
const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const EXAMPLES_DIR = path.join(SPEC_ROOT, "examples");
const VALIDATOR_DIR = path.join(SPEC_ROOT, "validator");

const exists = (target: string) => stat(target).then(() => true, () => false);
const haveValidator = (await exists(path.join(VALIDATOR_DIR, "node_modules"))) && (await exists(EXAMPLES_DIR));

async function fixtures(): Promise<string[]> {
  const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && e.name.endsWith(".csvx")).map((e) => path.join(EXAMPLES_DIR, e.name));
}

/** Every operation, in an order that is valid for any fixture. */
function editEverything(workbook: Workbook): Workbook {
  const first = workbook.sheets[0]!.id;
  const firstName = workbook.sheets[0]!.name;
  // Fixtures declare no names, so add some and a validation rule that reads one, to cover rewriting
  // of namedRanges and validation formulas as well.
  let w: Workbook = {
    ...workbook,
    namedRanges: [
      { name: "FirstCell", refersTo: `='${firstName}'!$A$2` },
      { name: "Block", refersTo: `='${firstName}'!$A$2:$A$5` },
      { name: "Constant", refersTo: "=6.28" },
    ],
  };
  w = setCell(w, first, "A2", "x");
  w = paste(w, first, "A3", [["=SUM(Block)"], ["=FirstCell"]]);
  w = {
    ...w,
    sheets: w.sheets.map((sheet, i) => (i === 0 ? { ...sheet, cells: { ...sheet.cells, A2: { ...sheet.cells?.A2, validation: { type: "list", formula1: `='${firstName}'!$A$2:$A$4` } } } } : sheet)),
  };
  w = insertRows(w, first, 2, 2);
  w = insertColumns(w, first, "A", 1);
  w = setCell(w, first, "B2", "hello");
  w = setCell(w, first, "B3", "=B2");
  w = paste(w, first, "C2", [["1", "2"], ["3", "=C2+D2"]]);
  w = applyStyle(w, first, ["B2", "C2"], { font: { bold: true }, numberFormat: "0.00" });
  w = applyStyle(w, first, ["B2"], { fill: { color: "#ffff00" } });
  w = clearStyle(w, first, ["C2"]);
  w = setPrint(w, first, { orientation: "landscape", scale: 90 });
  w = deleteRows(w, first, [3]);
  w = deleteColumns(w, first, ["A"]);
  w = addSheet(w);
  return renameSheet(w, first, "Renamed Sheet");
}

describe.skipIf(!haveValidator)("edited output conforms to schemas/*.json", async () => {
  const dirs = haveValidator ? await fixtures() : [];
  it("found fixtures", () => expect(dirs.length).toBeGreaterThan(0));
  it.each(dirs.map((dir) => [path.basename(dir), dir]))("%s", async (_name, dir) => {
    const edited = editEverything(await openDirectory(dir as string));
    const out = path.join(await mkdtemp(path.join(tmpdir(), "csvx-ts-edit-")), "edited.csvx");
    expect(edited.namedRanges?.length).toBe(3);
    await writePackage(edited, out);
    expect((await openPackage(out)).namedRanges).toEqual(edited.namedRanges);
    await expect(execFileAsync("node", [path.join(VALIDATOR_DIR, "bin", "csvx-validate.mjs"), out], { cwd: VALIDATOR_DIR })).resolves.not.toThrow();
  });
});
