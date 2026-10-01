// Browser-safe entry point: every export here works with no filesystem access, so bundling this
// for a browser (Vite, webpack, etc.) never pulls in node:fs. This is deliberately a separate file
// from index.ts, not a re-export filtered at the bundler level — index.ts transitively imports
// node.ts (which imports node:fs/promises), so importing "csvx-ts" itself in a browser build would
// still try to bundle that. Import "csvx-ts/browser" instead. See AGENTS.md and
// csvx-spec/AGENTS.md rule 5: csvx-web must call this directly rather than reimplementing CSVX
// parsing — this entry point is what makes that possible without a Node runtime.

export * from "./model.js";
export { loadWorkbookFromZip, writeWorkbookToZip, validateBuffer } from "./package.js";
export { parseCSV, stringifyCSV } from "./csv.js";
export { columnId, columnIndexFromId } from "./columns.js";
export type { Diagnostic, ValidationResult } from "./diagnostics.js";
export { evaluateFormula, recalculateCells } from "./calculate.js";
export type { CellValue, CellValueType, FormulaCellInput, CellMap, ReferenceRequest, ReferenceResolver, RecalculateOptions } from "./calculate.js";
export { parseFormula, FormulaParseError } from "./formula.js";
export type { FormulaNode } from "./formula.js";
export { formatValue, parseFormattedLiteral } from "./format.js";
