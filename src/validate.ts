// Structural, load-time validation — mirrors csvx-go's validation.go. This is NOT a JSON-Schema
// conformance check: per csvx-spec/AGENTS.md rule 3.3, that logic has exactly one canonical home
// (csvx-spec/validator), and no engine may grow a competing copy of it. This only reports whether
// a package loads at all and classifies the failure, the same limited scope Validate() has in Go.

import { stat } from "node:fs/promises";
import { openDirectory, openPackage } from "./node.js";

export interface Diagnostic {
  code: string;
  path?: string;
  message: string;
  severity: "error";
}

export interface ValidationResult {
  valid: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

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

function invalidResult(diagnostic: Diagnostic): ValidationResult {
  return { valid: false, errors: [diagnostic], warnings: [] };
}

function diagnosticForError(error: Error): Diagnostic {
  const message = error.message;
  let code = "INVALID_PACKAGE";
  if (containsAny(message, "missing package entry", "missing manifest", "missing workbook")) {
    code = "MISSING_RESOURCE";
  } else if (containsAny(message, "decode", "malformed")) {
    code = "INVALID_JSON";
  } else if (containsAny(message, "CSV", "csv")) {
    code = "INVALID_CSV";
  } else if (containsAny(message, "duplicate ZIP entry")) {
    code = "DUPLICATE_ENTRY";
  } else if (containsAny(message, "unsafe", "invalid ZIP entry path")) {
    code = "UNSAFE_ENTRY";
  }
  return { code, message, severity: "error" };
}

function containsAny(value: string, ...fragments: string[]): boolean {
  return fragments.some((fragment) => value.includes(fragment));
}
