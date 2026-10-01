# CSVX TypeScript Engine

The planned TypeScript engine for the [CSVX specification](../csvx-spec). Like every engine in
this project, it is specification-first: it will implement CSVX behavior, but its internal
architecture does not define the format. See `AGENTS.md` and `../csvx-spec/AGENTS.md` for the
binding rules.

## Current status: placeholder, no code yet

This repository does not contain an implementation. There is no `package.json`, no source, no
tests — only this README, `AGENTS.md`, and `LICENSE`. Nothing described below exists yet.

An earlier version of this README listed functionality (ZIP package loading, manifest/workbook
loading, typed metadata structures, package/extract CLI commands) as already present. None of it
was ever built in this checkout; that description was aspirational and got left in place as if it
were current state. It has been corrected here so this file can be trusted.

It is also worth noting that "package and extract CLI commands" was never a correct goal for this
repo in the first place: `../csvx-spec/AGENTS.md` rule 1 is explicit that engine libraries —
`csvx-go`, this repo, and any future one — must contain no CLI-shaped code (no argument parsing,
no subcommands, no user-facing output formatting). That functionality belongs in `csvx-cli` only.

## What this repo should become

Following the same shape `csvx-go` already has:

- A pure, programmable library: load, represent, edit, calculate, and write a CSVX workbook as
  data structures. No subcommands, no stdout formatting, no CLI entry point.
- A data model generated from `../csvx-spec/schemas/*.json`, not hand-typed. Run
  `csvx-cli codegen --lang ts --schema-dir ../csvx-spec/schemas --out <path>` once `csvx-cli` is
  on PATH (requires `json2ts`: `npm install -g json-schema-to-typescript`). Regenerate it every
  time a schema changes — that is part of landing the schema change, not a later task.
- A public API shaped for `csvx-web` to call directly in-browser once it exists (see
  `../csvx-spec/AGENTS.md` rule 5): a load/edit/write surface usable from a bundler/browser
  context, not just Node.
- CI that validates this engine's real output against `../csvx-spec/schemas/*.json` (via
  `../csvx-spec/validator/` until a native equivalent exists) and runs
  `../csvx-spec/tests/*.json` conformance vectors — on every change, not as a manual afterthought.

## Development rule

Each capability follows this sequence, same as every other repo in this project:

```text
Specify → create conformance fixtures → implement → run tests
```

The specification repository (`../csvx-spec/`) is the authority. If a field or behavior doesn't
already exist in `spec/`, `schemas/`, and `tests/`, fix `csvx-spec` first — don't invent it here.
