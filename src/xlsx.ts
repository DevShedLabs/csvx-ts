// XLSX import/export by delegating to the CSVX command-line tool. This engine does not parse or
// write XLSX itself (csvx-spec/AGENTS.md rule 4: `import`, `export` and `convert` live in csvx-cli,
// which calls csvx-go for the real work), so there is exactly one XLSX implementation in the
// project. This module is a *client* of that tool — it has no argument parsing or user-facing output
// of its own — and, like node.ts, it is Node-only: it is not exported from the browser entry.
//
// See README.md ("XLSX") for the other routes when `csvx` cannot be installed.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openPackage } from "./node.js";
import type { Workbook } from "./model.js";

const execFileAsync = promisify(execFile);

export interface CSVXCLIOptions {
  /** Path to the `csvx` executable. Defaults to the CSVX_CLI environment variable, then `csvx` on PATH. */
  cli?: string;
}

/** Thrown when the `csvx` tool is not installed or cannot be run. */
export class CSVXCLINotFoundError extends Error {
  constructor(command: string, cause?: unknown) {
    super(
      `The CSVX command-line tool (${command}) was not found. XLSX import and export are done by csvx-cli, not by this engine. ` +
        `Install it (https://github.com/DevShedLabs/csvx-cli) and put \`csvx\` on PATH, set CSVX_CLI, or pass { cli }. ` +
        `See the "XLSX" section of the csvx-ts README for other routes.`,
      cause === undefined ? undefined : { cause },
    );
  }
}

function cliCommand(options?: CSVXCLIOptions): string {
  return options?.cli ?? process.env.CSVX_CLI ?? "csvx";
}

async function run(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new CSVXCLINotFoundError(command, error);
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`csvx ${args[0]} failed${stderr ? `: ${stderr}` : ""}`, { cause: error });
  }
}

/** Reports whether the CSVX command-line tool can be run. */
export async function isCSVXCLIAvailable(options?: CSVXCLIOptions): Promise<boolean> {
  try {
    await execFileAsync(cliCommand(options), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/** Imports an XLSX file by running `csvx import`, then loads the resulting package with this
 * engine. The original XLSX is embedded in the package as source (csvx-spec 14.1). */
export async function importXLSX(filename: string, options?: CSVXCLIOptions): Promise<Workbook> {
  const directory = await mkdtemp(path.join(tmpdir(), "csvx-ts-xlsx-"));
  try {
    const output = path.join(directory, "imported.csvx");
    await run(cliCommand(options), ["import", filename, output]);
    return await openPackage(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Recovers the embedded original XLSX from a CSVX package by running `csvx export`. Edited
 * workbooks cannot be exported to XLSX yet by any engine (csvx-spec/CSVX-GAPS.md, item 2). */
export async function exportXLSX(csvxFilename: string, output: string, options?: CSVXCLIOptions): Promise<void> {
  await run(cliCommand(options), ["export", csvxFilename, output]);
}
