// Public API. Browser-usable pieces (package.ts, csv.ts, model.ts, columns.ts) are exported
// unconditionally; node.ts's filesystem wrappers are exported too today since this package only
// targets Node so far, but are isolated to one module so a future browser-only entry point can
// import everything except node.ts — see csvx-spec/AGENTS.md rule 5 and this repo's AGENTS.md.

export * from "./model.js";
export { loadWorkbookFromZip, writeWorkbookToZip } from "./package.js";
export { openPackage, writePackage, openDirectory, packageDirectory, extractPackage } from "./node.js";
export { parseCSV, stringifyCSV } from "./csv.js";
export { columnId } from "./columns.js";
export { validate } from "./validate.js";
export type { Diagnostic, ValidationResult } from "./validate.js";
