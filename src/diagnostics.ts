// Pure, environment-agnostic error classification shared by validate.ts (Node, path-based) and
// package.ts's validateBuffer (browser-safe, buffer-based) — mirrors csvx-go's validation.go. This
// is NOT a JSON-Schema conformance check: per csvx-spec/AGENTS.md rule 3.3, that logic has exactly
// one canonical home (csvx-spec/validator), and no engine may grow a competing copy of it. This
// only classifies whether a package loaded at all and why, the same limited scope Validate() has
// in Go.

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

export function invalidResult(diagnostic: Diagnostic): ValidationResult {
  return { valid: false, errors: [diagnostic], warnings: [] };
}

export function diagnosticForError(error: Error): Diagnostic {
  const message = error.message;
  let code = "INVALID_PACKAGE";
  if (containsAny(message, "INVALID_NAMED_RANGE")) {
    code = "INVALID_NAMED_RANGE";
  } else if (containsAny(message, "missing package entry", "missing manifest", "missing workbook")) {
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
