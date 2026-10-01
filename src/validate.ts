// Node path-based validation. See diagnostics.ts for the shared classification logic and
// package.ts's validateBuffer for the browser-safe, buffer-based equivalent.

import { stat } from "node:fs/promises";
import { diagnosticForError, invalidResult } from "./diagnostics.js";
import { openDirectory, openPackage } from "./node.js";
import type { ValidationResult } from "./diagnostics.js";

export type { Diagnostic, ValidationResult } from "./diagnostics.js";

export async function validate(filename: string): Promise<ValidationResult> {
  try {
    const info = await stat(filename);
    if (info.isDirectory()) {
      await openDirectory(filename);
    } else {
      await openPackage(filename);
    }
  } catch (error) {
    return invalidResult(diagnosticForError(error as Error));
  }
  return { valid: true, errors: [], warnings: [] };
}
