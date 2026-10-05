// Buffer-based CSVX package read/write: no filesystem access, so this module works unmodified in
// a browser as well as Node (see csvx-spec/AGENTS.md rule 5 and this repo's AGENTS.md — csvx-web
// should eventually call this directly in-browser). Filesystem convenience wrappers live in
// ./node.ts and are the only place this engine touches `node:fs`.

import JSZip from "jszip";
import { columnId } from "./columns.js";
import { parseCSV, stringifyCSV } from "./csv.js";
import { diagnosticForError, invalidResult } from "./diagnostics.js";
import type { ValidationResult } from "./diagnostics.js";
import { InvalidNamedRangeError, validateNamedRanges } from "./names.js";
import type { CellMetadata, Column, Manifest, Print, Sheet, SourceMetadata, Style, Workbook, WorkbookDocument } from "./model.js";

const MANIFEST_PATH = "manifest.json";
// A fixed timestamp on every entry, so writing the same workbook twice gives identical bytes (spec
// 01-container.md: writers SHOULD use stable ordering and timestamps). ZIP's own epoch.
const FILE_OPTIONS = { date: new Date(Date.UTC(1980, 0, 1)), createFolders: false };

const SOURCE_PATH = "source/original.xlsx";
const SOURCE_METADATA_PATH = "source/source.json";

/** Loads a CSVX workbook from an in-memory ZIP buffer (the contents of a .csvx file). */
export async function loadWorkbookFromZip(data: Uint8Array | ArrayBuffer | Blob): Promise<Workbook> {
  const zip = await JSZip.loadAsync(data);
  assertSafeEntryNames(zip);

  const manifest = await readJSONEntry<Manifest>(zip, MANIFEST_PATH);
  if (manifest.format !== "csvx" || manifest.version !== "1.0" || manifest.workbook !== "workbook.json") {
    throw new Error("unsupported CSVX manifest");
  }

  const document = await readJSONEntry<WorkbookDocument>(zip, manifest.workbook);
  if (document.version !== "1.0" || !document.sheets || document.sheets.length === 0) {
    throw new Error("invalid workbook resource");
  }

  const nameProblems = validateNamedRanges(document.namedRanges);
  if (nameProblems.length > 0) throw new InvalidNamedRangeError(nameProblems);
  const workbook: Workbook = {
    id: document.id,
    version: document.version,
    ...(document.namedRanges ? { namedRanges: document.namedRanges } : {}),
    calculation: document.calculation,
    source: document.source,
    sheets: [],
  };

  if (workbook.source) {
    const sourceFile = zip.file(SOURCE_PATH);
    if (!sourceFile) {
      throw new Error("missing embedded XLSX source");
    }
    workbook.sourceBytes = await sourceFile.async("uint8array");
  }

  const stylesPath = document.styles || "styles.json";
  const stylesFile = zip.file(stylesPath);
  if (stylesFile) {
    const stylesDocument = await readJSONEntry<{ styles: Style[] }>(zip, stylesPath);
    workbook.styles = stylesDocument.styles;
  }

  for (const entry of document.sheets) {
    const csvFile = zip.file(entry.path);
    if (!csvFile) {
      throw new Error(`missing sheet CSV "${entry.path}"`);
    }
    const csvText = await csvFile.async("text");
    const sheet = buildSheetFromCSV(entry, csvText);
    if (entry.metadata) {
      const metadataFile = zip.file(entry.metadata);
      if (!metadataFile) {
        throw new Error(`missing sheet metadata "${entry.metadata}"`);
      }
      applySheetMetadata(sheet, await metadataFile.async("text"), entry);
    }
    workbook.sheets.push(sheet);
  }

  return workbook;
}

/** Serializes a workbook to an in-memory ZIP buffer (the contents of a .csvx file). */
/** Whether a sheet has anything the CSV cannot hold, so it needs a metadata sidecar (spec/03-sheets.md):
 * column types or widths or other properties, row heights, cell metadata, or print settings. One
 * decision, used for both the workbook.json reference and the file itself, so they cannot disagree. */
function needsMetadata(sheet: Sheet): boolean {
  return (
    Boolean(sheet.metadataPath) ||
    Boolean(sheet.print) ||
    Object.keys(sheet.cells ?? {}).length > 0 ||
    Object.keys(sheet.rowHeights ?? {}).length > 0 ||
    sheet.columns.some((column) => Object.keys(column).some((key) => key !== "id" && key !== "name"))
  );
}

export async function writeWorkbookToZip(workbook: Workbook): Promise<Uint8Array> {
  if (!workbook.id || !workbook.version || workbook.sheets.length === 0) {
    throw new Error("workbook requires an id, version, and at least one sheet");
  }

  const zip = new JSZip();
  const manifest: Manifest = { format: "csvx", version: "1.0", workbook: "workbook.json", files: [] };
  const document: WorkbookDocument = {
    id: workbook.id,
    version: workbook.version,
    ...(workbook.namedRanges && workbook.namedRanges.length > 0 ? { namedRanges: workbook.namedRanges } : {}),
    calculation: workbook.calculation,
    source: workbook.source,
    sheets: [],
  };

  if (workbook.styles && workbook.styles.length > 0) {
    document.styles = "styles.json";
    manifest.files.push("styles.json");
  }

  for (const sheet of workbook.sheets) {
    if (!sheet.id || !sheet.name) {
      throw new Error("sheet requires an id and name");
    }
    const path = sheet.path || `sheets/${sheet.id}.csv`;
    const metadataPath = needsMetadata(sheet) ? sheet.metadataPath || `sheets/${sheet.id}.meta.json` : undefined;
    document.sheets.push({ id: sheet.id, name: sheet.name, path, ...(metadataPath ? { metadata: metadataPath } : {}) });
    manifest.files.push(path);
    if (metadataPath) {
      manifest.files.push(metadataPath);
    }
  }
  manifest.files = ["manifest.json", "workbook.json", ...manifest.files];
  if (workbook.source && workbook.sourceBytes && workbook.sourceBytes.length > 0) {
    manifest.files.push(SOURCE_PATH, SOURCE_METADATA_PATH);
  }

  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2), FILE_OPTIONS);
  zip.file("workbook.json", JSON.stringify(document, null, 2), FILE_OPTIONS);

  for (const sheet of workbook.sheets) {
    const path = sheet.path || `sheets/${sheet.id}.csv`;
    const header = sheet.columns.map((column) => column.name ?? "");
    zip.file(path, stringifyCSV(header, sheet.records), FILE_OPTIONS);

    const metadataPath = needsMetadata(sheet) ? sheet.metadataPath || `sheets/${sheet.id}.meta.json` : undefined;
    if (metadataPath) {
      const metadata = {
        id: sheet.id,
        name: sheet.name,
        columns: sheet.columns,
        rowHeights: sheet.rowHeights,
        print: sheet.print,
        cells: sheet.cells,
      };
      zip.file(metadataPath, JSON.stringify(metadata, null, 2), FILE_OPTIONS);
    }
  }

  if (workbook.styles && workbook.styles.length > 0) {
    zip.file("styles.json", JSON.stringify({ styles: workbook.styles }, null, 2), FILE_OPTIONS);
  }
  if (workbook.source && workbook.sourceBytes && workbook.sourceBytes.length > 0) {
    zip.file(SOURCE_PATH, workbook.sourceBytes, FILE_OPTIONS);
    zip.file(SOURCE_METADATA_PATH, JSON.stringify(workbook.source, null, 2), FILE_OPTIONS);
  }

  return zip.generateAsync({ type: "uint8array" });
}

/** Browser-safe equivalent of validate.ts's path-based validate(): attempts to load the buffer
 * and classifies the failure the same way, without ever touching a filesystem. */
export async function validateBuffer(data: Uint8Array | ArrayBuffer | Blob): Promise<ValidationResult> {
  try {
    await loadWorkbookFromZip(data);
  } catch (error) {
    return invalidResult(diagnosticForError(error as Error));
  }
  return { valid: true, errors: [], warnings: [] };
}

/** Validates a workbook that exists only in memory — for example one that has been edited but not
 * yet saved — by serializing it exactly as a save would and loading the result back, so what is
 * checked is what would be written. Browser-safe. Like validateBuffer, this is a structural check
 * (the package loads, resources decode, named ranges are valid); JSON-Schema conformance has one
 * home, csvx-spec/validator (csvx-spec/AGENTS.md rule 3.3), which a Node host can run on the bytes
 * from writeWorkbookToZip. */
export async function validateWorkbook(workbook: Workbook): Promise<ValidationResult> {
  let data: Uint8Array;
  try {
    data = await writeWorkbookToZip(workbook);
  } catch (error) {
    return invalidResult(diagnosticForError(error as Error));
  }
  return validateBuffer(data);
}

function buildSheetFromCSV(entry: WorkbookDocument["sheets"][number], csvText: string): Sheet {
  let header: string[];
  let records: string[][];
  try {
    ({ header, records } = parseCSV(csvText));
  } catch (error) {
    throw new Error(`sheet "${entry.name}": ${(error as Error).message}`);
  }
  const columns: Column[] = header.map((name, index) => ({ id: columnId(index), name }));
  return { id: entry.id, name: entry.name, path: entry.path, metadataPath: entry.metadata, columns, records, cells: {} };
}

function applySheetMetadata(sheet: Sheet, metadataText: string, entry: WorkbookDocument["sheets"][number]): void {
  let resource: {
    id?: string;
    name?: string;
    columns?: Column[];
    rowHeights?: Record<number, number>;
    print?: Print;
    cells?: Record<string, CellMetadata>;
  };
  try {
    resource = JSON.parse(metadataText);
  } catch (error) {
    throw new Error(`decode sheet metadata "${entry.metadata}": ${(error as Error).message}`);
  }
  if ((resource.id && resource.id !== sheet.id) || (resource.name && resource.name !== sheet.name)) {
    throw new Error(`sheet metadata identity mismatch for "${entry.name}"`);
  }
  if (resource.columns && resource.columns.length > 0) {
    if (resource.columns.length !== sheet.columns.length) {
      throw new Error(`sheet "${sheet.name}" metadata column count does not match CSV`);
    }
    resource.columns.forEach((column, index) => {
      const header = sheet.columns[index]?.name;
      if (column.name !== undefined && column.name !== header) {
        throw new Error(`COLUMN_NAME_MISMATCH: sheet "${sheet.name}" column ${columnId(index)} is "${header}" in the CSV header but "${column.name}" in its metadata`);
      }
    });
    sheet.columns = resource.columns;
  }
  sheet.rowHeights = resource.rowHeights;
  sheet.print = resource.print;
  sheet.cells = resource.cells;
}

async function readJSONEntry<T>(zip: JSZip, name: string): Promise<T> {
  const file = zip.file(name);
  if (!file) {
    throw new Error(`missing package entry "${name}"`);
  }
  const text = await file.async("text");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`decode "${name}": ${(error as Error).message}`);
  }
}

/** Rejects ZIP entries with absolute, parent-escaping, or NUL-containing paths before anything
 * else reads them — the same check csvx-go's packageEntries makes before trusting manifest-
 * referenced paths. (Exact-duplicate-name rejection, which Go's archive/zip surfaces directly, is
 * not implemented here: JSZip's own loader silently keeps the last of two same-named entries
 * before this code ever sees the list, so that specific protection is a known gap, not something
 * faked — see csvx-spec/AGENTS.md rule 3.7 on not pretending a gap is covered.) */
function assertSafeEntryNames(zip: JSZip): void {
  zip.forEach((relativePath) => {
    if (
      relativePath === "" ||
      relativePath.startsWith("/") ||
      relativePath.includes("\0") ||
      relativePath.split("/").includes("..")
    ) {
      throw new Error(`invalid ZIP entry path "${relativePath}"`);
    }
  });
}

export type { SourceMetadata, Style, Workbook };
