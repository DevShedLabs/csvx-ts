// Filesystem-backed convenience wrappers around ./package.ts. This is the only module in this
// engine that touches node:fs — everything else (package.ts, csv.ts, model.ts) works on in-memory
// buffers so it can run in a browser too (csvx-spec/AGENTS.md rule 5). Mirrors csvx-go's
// Open/Load/WritePackage/OpenDirectory/PackageDirectory/ExtractPackage.

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { loadWorkbookFromZip, writeWorkbookToZip } from "./package.js";
import type { Workbook } from "./model.js";
import { importCSV } from "./csv-import.js";
import type { CSVImportOptions, CSVImportResult } from "./csv-import.js";

/** Reads a CSVX ZIP package (.csvx file) from disk. */
export async function openPackage(filename: string): Promise<Workbook> {
  const info = await stat(filename);
  if (info.isDirectory()) {
    throw new Error(`CSVX path is a directory: ${filename}`);
  }
  const data = await readFile(filename);
  return loadWorkbookFromZip(data);
}

/** Writes a workbook to a CSVX ZIP package (.csvx file) on disk. */
export async function writePackage(workbook: Workbook, output: string): Promise<void> {
  const data = await writeWorkbookToZip(workbook);
  await writeFile(output, data);
}

/** Reads an unpacked CSVX package directory by zipping it in memory and reusing the ZIP loader —
 * the same data ends up read either way, so this avoids a second, divergent parsing path. */
export async function openDirectory(directory: string): Promise<Workbook> {
  const info = await stat(directory);
  if (!info.isDirectory()) {
    throw new Error(`CSVX path is not a directory: ${directory}`);
  }
  const zip = new JSZip();
  await addDirectoryToZip(zip, directory, directory);
  const data = await zip.generateAsync({ type: "uint8array" });
  return loadWorkbookFromZip(data);
}

/** Packages an unpacked CSVX directory into a ZIP .csvx file, copying files byte-for-byte (same
 * as csvx-go's PackageDirectory: no reinterpretation of CSV/JSON contents happens here). */
export async function packageDirectory(directory: string, output: string): Promise<void> {
  const info = await stat(directory);
  if (!info.isDirectory()) {
    throw new Error(`CSVX input is not a directory: ${directory}`);
  }
  const zip = new JSZip();
  await addDirectoryToZip(zip, directory, directory);
  const data = await zip.generateAsync({ type: "uint8array" });
  await writeFile(output, data);
}

/** Extracts a CSVX ZIP package into an unpacked directory. */
export async function extractPackage(filename: string, directory: string): Promise<void> {
  const info = await stat(filename);
  if (info.isDirectory()) {
    throw new Error(`CSVX package path is a directory: ${filename}`);
  }
  const data = await readFile(filename);
  const zip = await JSZip.loadAsync(data);
  const root = path.resolve(directory);
  await mkdir(root, { recursive: true });

  const entries: Promise<void>[] = [];
  zip.forEach((relativePath, entry) => {
    entries.push(
      (async () => {
        const target = safeExtractionPath(root, relativePath);
        if (entry.dir) {
          await mkdir(target, { recursive: true });
          return;
        }
        await mkdir(path.dirname(target), { recursive: true });
        const body = await entry.async("nodebuffer");
        await writeFile(target, body);
      })(),
    );
  });
  await Promise.all(entries);
}

function safeExtractionPath(root: string, name: string): string {
  const cleanName = path.normalize(name);
  const target = path.join(root, cleanName);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`unsafe extraction path "${name}"`);
  }
  return target;
}

async function addDirectoryToZip(zip: JSZip, root: string, current: string): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, root, fullPath);
      continue;
    }
    const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
    const contents = await readFile(fullPath);
    zip.file(relativePath, contents);
  }
}

/** Reads a CSV file and imports it (spec §11.1); the sheet name defaults to the file stem. */
export async function importCSVFile(filename: string, options: CSVImportOptions = {}): Promise<CSVImportResult> {
  const data = await readFile(filename);
  const stem = path.basename(filename, path.extname(filename));
  return importCSV(new Uint8Array(data), { ...options, name: options.name || stem || undefined });
}
