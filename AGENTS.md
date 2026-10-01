# Architecture rules for this repo

The binding rules for this project live in `../csvx-spec/AGENTS.md`. Read it before making any
change here. The short version for this repo specifically:

- `csvx-spec` is the authority. This engine implements the spec; it does not define it.
- Generate data model types from `../csvx-spec/schemas/*.json` with
  `csvx-cli codegen --lang ts --schema-dir ../csvx-spec/schemas --out <path>` (from a csvx-ts
  checkout); do not hand-type interfaces from memory of what the shape "should" be. `csvx-go`
  shipped exactly that mistake (`styles.json` written as a numeric-keyed map instead of the
  schema's array of `{id, ...}` objects) because its struct was hand-typed and never checked
  against the schema. That command requires `json2ts` on PATH
  (`npm install -g json-schema-to-typescript`) — see `../csvx-cli`'s own help (`csvx codegen --help`)
  for details. Regenerating is part of landing any schema change, not a follow-up task.
- Validate this engine's actual JSON output against `../csvx-spec/schemas/*.json` in CI, on every
  change — see `../csvx-spec/validator/` for the reference validator.
- Run `../csvx-spec/tests/*.json` conformance vectors through this engine in CI.
- If you need a field or behavior the spec doesn't describe, fix `csvx-spec` first — spec, schema,
  and test vector — then implement it here. Don't invent it here and let the spec catch up later.
- This is the engine `csvx-web` should eventually call directly (in-browser, since it's already
  JS/TS) instead of reimplementing CSVX logic itself. Keep the public API shaped for that: a
  browser-friendly load/edit/write surface, not just a Node CLI.

See `../csvx-spec/AGENTS.md` for full detail and the reasoning behind these rules.
