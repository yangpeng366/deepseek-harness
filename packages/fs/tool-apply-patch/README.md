# @deepseek-ai/dsh-tool-apply-patch

Model-facing `apply_patch` tool for DeepSeek Harness — a TypeScript port of
[`codex-rs/apply-patch`](https://github.com/openai/codex/tree/main/codex-rs/apply-patch).

## Status (2026-08-24)

This package is **scaffold-only** in this commit:

- `src/markers.ts` — verbatim marker constants from the codex reference
- `src/types.ts` — `Hunk`, `UpdateFileChunk`, `ApplyPatchArgs`, `ParseError`
- `src/parser.ts` — `parsePatch(patch, mode)` implementing strict + lenient modes
- `src/index.ts` — re-exports and Cordis plugin metadata

Not yet wired in this commit (pending the next round):

- Cordis `apply(ctx, config)` body that registers the tool via `defineTool`
- `FsWriteIntent` bridge that turns Add/Delete/Update hunks into ctx.fs calls
- The fuzzy line-finder for Update chunks (port of `seek_sequence.rs`)
- Snapshot test against the assembled CLI

## Why this matters

`packages/fs` ships `tool-fs` (read/write/edit) and `tool-str-replace-editor`
(view/create/str_replace) but no `apply_patch`. Codex''s flagship model-facing
patch format — used by gpt-4.1 and downstream consumers — has no harness
equivalent, so every harness agent that wants to mirror codex behaviour has
to hand-roll its own driver. This package fills that gap on the public
`ctx.fs` seam.

## Layout mirror

| codex-rs file          | dsh port                |
|------------------------|-------------------------|
| `parser.rs`            | `src/parser.ts`         |
| `markers` (in parser)  | `src/markers.ts`        |
| `streaming_parser.rs`  | (next round)            |
| `seek_sequence.rs`     | (next round)            |
| `invocation.rs`        | (next round — `defineTool`) |
| `lib.rs`               | `src/index.ts`          |