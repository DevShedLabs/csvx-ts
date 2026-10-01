// Browser-safe entry point: every export here works with no filesystem access, so bundling this
// for a browser (Vite, webpack, etc.) never pulls in node:fs. This is deliberately a separate file
// from index.ts, not a re-export filtered at the bundler level — index.ts transitively imports
// node.ts (which imports node:fs/promises), so importing "csvx-ts" itself in a browser build would
// still try to bundle that. Import "csvx-ts/browser" instead. See AGENTS.md and
// csvx-spec/AGENTS.md rule 5: csvx-web must call this directly rather than reimplementing CSVX
// parsing — this entry point is what makes that possible without a Node runtime.

export * from "./model.js";
export { loadWorkbookFromZip, writeWorkbookToZip } from "./package.js";
export { parseCSV, stringifyCSV } from "./csv.js";
export { columnId } from "./columns.js";
