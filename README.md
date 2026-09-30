# CSVX TypeScript Engine

The TypeScript engine for the CSVX specification. It is intentionally
specification-first: the engine must conform to CSVX behavior, but its internal architecture does
not define the format.

## Current scope

The initial package provides the Phase 1 foundation:

- CSVX ZIP package loading
- Manifest and workbook loading
- UTF-8 CSV sheet loading
- Optional `.meta.json` sheet metadata
- Typed metadata structures for columns, formulas, caches, styles, and validation
- Sparse cell metadata addressed by A1 coordinates
- Duplicate and unsafe ZIP entry rejection
- Package and extract CLI commands for developer workflows

Formula parsing, calculation, import/export, and full CLI operations will be added behind the
same canonical workbook model. Package writing and extract/package round-trip support are now
available for developer workflows.
