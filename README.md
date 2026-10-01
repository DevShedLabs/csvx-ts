# CSVX TypeScript Engine

The TypeScript engine for the [CSVX specification](../csvx-spec). Like every engine in this
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

Not yet implemented: formula parsing/recalculation, XLSX import/export, full JSON-Schema
conformance validation (that lives in `../csvx-spec/validator` for now), exact-duplicate-ZIP-entry
rejection (see the comment on `assertSafeEntryNames` in `src/package.ts` for why that one specific
check is a known gap rather than something faked).

## Development rule

Each capability follows this sequence:

```text
Specify → create conformance fixtures → implement → run tests
```

The specification repository is the authority: `../csvx-spec/`.

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
