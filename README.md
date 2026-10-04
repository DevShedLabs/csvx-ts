# CSVX TypeScript Engine

The TypeScript engine for the [CSVX specification](https://github.com/DevShedLabs/csvx-spec). Like every engine in this
project, it is specification-first: it implements CSVX behavior, but its internal architecture
does not define the format. See `AGENTS.md` and `../csvx-spec/AGENTS.md` for the binding rules.

## Current scope

The initial pass provides the Phase 1 foundation, same shape as `csvx-go`:

- CSVX ZIP package loading and writing (`loadWorkbookFromZip`/`writeWorkbookToZip`, buffer-based —
  no filesystem access, so these work in a browser as well as Node)
- Filesystem convenience wrappers (`openPackage`, `writePackage`, `openDirectory`,
  `packageDirectory`, `extractPackage`) — the only place this engine touches `node:fs`
- UTF-8 CSV sheet loading/writing, RFC 4180–compatible
- Optional `.meta.json` sheet metadata: formulas, cached values, per-cell styles, validation
- A data model generated from `../csvx-spec/schemas/*.json` (`src/schema/generated.ts`, via
  `csvx-cli codegen --lang ts`), not hand-typed — see `AGENTS.md` for why that matters
- Zip-slip-safe extraction (absolute/`..`/NUL-containing entry paths are rejected)
- Structural, load-time validation (`validate()` for paths, `validateBuffer()` for in-memory ZIP
  data — the latter is browser-safe and exported from `./browser` too)

- A formula engine: parsing, evaluation, workbook-wide recalculation (ranges, cross-sheet
  references, cycles), and workbook names
- The edit operations of spec chapter 15 (`insertRows`, `deleteColumns`, `setCell`, `paste`,
  `applyStyle`, `renameSheet`, ...), which rewrite formula references, names, validation formulas
  and print settings as the spec requires
- CSV import (spec 11.1) and text case conversion
- Node-only helpers that call the `csvx` command-line tool for XLSX (see "XLSX" below)

Not implemented here: XLSX parsing/writing (see "XLSX" for how to get it), print pagination, and
full JSON-Schema conformance validation (that lives in `../csvx-spec/validator`; this engine does
not carry its own copy, per `../csvx-spec/AGENTS.md` rule 3.3). Exact-duplicate-ZIP-entry rejection
is a known gap — see the comment on `assertSafeEntryNames` in `src/package.ts`.

## Development rule

Each capability follows this sequence:

```text
Specify → create conformance fixtures → implement → run tests
```

The specification repository is the authority: `https://github.com/DevShedLabs/csvx-spec`.

## Install

```bash
npm install @devshedlabs/csvx-ts          # once published to npm
npm install github:DevShedLabs/csvx-ts#v0.1.11 --allow-git=all   # from a tag; builds on install
```

The package ships both ESM and CommonJS builds, so `import` and `require()` (and
`require.resolve`) both work, including from an Electron main process. The version in
`package.json` follows the shared csvx-* tag; `scripts/check-version.mjs` (run by `npm run check`)
fails if it falls behind.

## Usage

In Node:

```ts
import { openPackage } from "@devshedlabs/csvx-ts";

const workbook = await openPackage("report.csvx");
console.log(workbook.sheets[0].records);
```

In a browser (e.g. `csvx-web`), import the `/browser` subpath instead — the main entry
transitively pulls in `node:fs/promises` via `node.ts`, which a bundler can't resolve client-side:

```ts
import { loadWorkbookFromZip } from "@devshedlabs/csvx-ts/browser";

const workbook = await loadWorkbookFromZip(await file.arrayBuffer());
```

CSV is the canonical sheet data layer. Metadata that CSV cannot represent is stored in the
matching `.meta.json` sidecar.

To exercise this library from the command line, use
[`csvx-cli`](https://github.com/DevShedLabs/csvx-cli) — this package is a library only; see
`AGENTS.md` for why CLI-shaped code does not belong here.

## XLSX

This engine does **not** read or write XLSX. The project keeps exactly one XLSX implementation (in
`csvx-go`, driven by `csvx-cli`) so the formats cannot drift apart, and CSVX-to-XLSX export of an
*edited* workbook is done by `csvx-go` (via `csvx export`), not here. There are several ways to get XLSX data into a
TypeScript program; pick by where your code runs:

1. **`csvx` on the machine (recommended for Node).** Install
   [`csvx-cli`](https://github.com/DevShedLabs/csvx-cli) and call it through this package:

   ```ts
   import { importXLSX, exportXLSX, isCSVXCLIAvailable } from "@devshedlabs/csvx-ts";

   if (await isCSVXCLIAvailable()) {
     const workbook = await importXLSX("report.xlsx");        // runs `csvx import`, then loads the package
     await exportXLSX("report.csvx", "report.xlsx");           // runs `csvx export`
   }
   ```

   The tool is found as `csvx` on `PATH`, or via the `CSVX_CLI` environment variable, or
   `{ cli: "/path/to/csvx" }`. If it is missing you get a `CSVXCLINotFoundError` that says so.
   These helpers are Node-only and are not part of the `/browser` entry.

2. **Convert ahead of time, then load `.csvx`.** Run `csvx import report.xlsx report.csvx` in a
   build step, a script, or a CI job, and give your program the `.csvx`. Nothing XLSX-specific
   remains at runtime, and this works in the browser too (`loadWorkbookFromZip`).

3. **A small Go program or service.** If you cannot install the CLI, write a few lines of Go that
   import [`csvx-go`](https://github.com/DevShedLabs/csvx-go) at the same tag and call
   `csvx.Convert("report.xlsx", "report.csvx")`, run it as a sidecar process or behind an HTTP
   endpoint, and load its output here. Prefer route 1 unless you need to embed the conversion in
   your own Go service, since the CLI is that program already.

4. **A browser app** cannot run a CLI. Use route 2 (convert before upload) or route 3 (a server
   endpoint that converts and returns the `.csvx`), and keep XLSX parsing out of the client.

If your workload is mostly XLSX in and out, consider using `csvx-go` directly: it has the same
edit and formula operations as this package and also imports XLSX.

## Development

```bash
npm install                # install dependencies
npm run codegen             # regenerate src/schema/generated.ts from ../csvx-spec/schemas
npx tsc --noEmit             # type-check
npx vitest run               # run tests (includes real csvx-spec/examples fixtures + schema validation)
npm run build                # compile to dist/
```

### Pre-push checks (local, since GitHub Actions minutes are limited)

`scripts/check.sh` runs the same checks CI would (type-check, test, build). Run it any time:

```bash
./scripts/check.sh
```

A git hook runs it automatically before every push, blocking the push if it fails. Enable it once
per clone (this is local git config, not something that comes from cloning the repo):

```bash
git config core.hooksPath .githooks
```

Skip in a genuine emergency with `git push --no-verify` — prefer fixing the failure instead. See
`../csvx-spec/AGENTS.md` section 6 for why this exists: it's the interim stand-in for real CI.
