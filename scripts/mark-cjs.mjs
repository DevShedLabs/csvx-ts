// Marks dist/cjs as CommonJS: the package is "type": "module", so the second (CommonJS) build needs
// its own package.json for Node to treat those .js files correctly.
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist/cjs", { recursive: true });
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }) + "\n");
