// Validity rules for workbook names that JSON Schema cannot express (csvx-spec/spec/02-workbook.md,
// Named ranges). Shape (patterns, required fields) is the canonical validator's job and is not
// repeated here (csvx-spec/AGENTS.md rule 3.3); this only checks the cross-field and semantic rules.

import { FormulaParseError, parseFormula } from "./formula.js";
import type { FormulaNode } from "./formula.js";

export interface NamedRangeDiagnostic {
  code: "INVALID_NAMED_RANGE";
  name: string;
  message: string;
}

const CORE_FUNCTIONS = new Set(["SUM", "COUNT", "IF", "ROUND", "ABS"]);
const CELL_LIKE = /^\$?[A-Za-z]+\$?\d+$/;

/** Thrown when a package declares an invalid name. */
export class InvalidNamedRangeError extends Error {
  constructor(public readonly diagnostics: NamedRangeDiagnostic[]) {
    super(`INVALID_NAMED_RANGE: ${diagnostics.map((d) => `${d.name}: ${d.message}`).join("; ")}`);
  }
}

function problemWithExpression(node: FormulaNode): string | undefined {
  switch (node.kind) {
    case "name":
      return "refersTo must not use a name";
    case "reference":
      return node.sheet === undefined ? "every reference in refersTo must be sheet-qualified" : undefined;
    case "range":
      return node.start.sheet === undefined && node.end.sheet === undefined ? "every reference in refersTo must be sheet-qualified" : undefined;
    case "call":
      return node.args.map(problemWithExpression).find(Boolean);
    case "unary":
    case "percent":
      return problemWithExpression(node.operand);
    case "binary":
      return problemWithExpression(node.left) ?? problemWithExpression(node.right);
    default:
      return undefined;
  }
}

/** Checks declared names against the rules in spec/02-workbook.md. Returns one diagnostic per
 * offending name; an empty array means valid. */
export function validateNamedRanges(namedRanges: ReadonlyArray<{ name: string; refersTo: string }> | undefined): NamedRangeDiagnostic[] {
  const diagnostics: NamedRangeDiagnostic[] = [];
  const seen = new Set<string>();
  for (const { name, refersTo } of namedRanges ?? []) {
    const fail = (message: string) => diagnostics.push({ code: "INVALID_NAMED_RANGE", name, message });
    if (CELL_LIKE.test(name)) fail("a name must not look like a cell reference");
    else if (/^(true|false)$/i.test(name)) fail("TRUE and FALSE are reserved");
    else if (CORE_FUNCTIONS.has(name.toUpperCase())) fail("a Core function name is reserved");
    else if (seen.has(name.toLowerCase())) fail("names must be unique ignoring case");
    else {
      try {
        const problem = problemWithExpression(parseFormula(refersTo));
        if (problem) fail(problem);
      } catch (error) {
        if (!(error instanceof FormulaParseError)) throw error;
        fail(`refersTo does not parse: ${error.message}`);
      }
    }
    seen.add(name.toLowerCase());
  }
  return diagnostics;
}
