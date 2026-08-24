# @deepseek-ai/dsh-tool-apply-patch

Model-facing `apply_patch` tool for DeepSeek Harness — a TypeScript port of
[`codex-rs/apply-patch`](https://github.com/openai/codex/tree/main/codex-rs/apply-patch).

## Status (2026-08-25, round 7)

All four upstream Rust modules are now ported and tested, plus the
data-plane and live Cordis wiring. Round 7 lifts the model-facing prompt
template out of `apply.ts` into `apply_patch_tool_instructions.md` at the
package root and loads it via `readFile(import.meta.url)` at apply time.

The current `apply_patch_tool_instructions.md` is a condensed dsh-specific
paraphrase, not a verbatim copy of `codex-rs/apply-patch/src/lib.rs`
`APPLY_PATCH_TOOL_INSTRUCTIONS` (which is `include_str!` of the upstream
`apply_patch_tool_instructions.md` and carries the full codex-rs grammar
spec). Pulling the upstream file verbatim is tracked separately; this round
only ships the extraction so the prompt lives next to the package metadata
and can be overridden by cordis.yml overlay without a TypeScript rebuild.

- `src/markers.ts` — verbatim marker constants from the codex reference
- `src/types.ts` — `Hunk`, `UpdateFileChunk`, `ApplyPatchArgs`, `ParseError`, `ParseMode`
- `src/parser.ts` — `parsePatch(patch, mode)` with strict + lenient (heredoc-aware) modes
- `src/seek-sequence.ts` — fuzzy line locator with four passes (exact / trimEnd / trim / Unicode-normalise), mirroring `seek_sequence.rs`
- `src/apply-core.ts` — pure data-plane core mirroring `codex-rs/apply-patch/src/lib.rs` `apply_hunks`:
  - `PatchFileBackend` interface (resolve/read/write/delete)
  - `applyPatch` / `applyPatchFromArgs` entry points
  - structured `HunkOutcome` reports (added/updated/deleted/failed)
  - typed error classes: `ApplyPatchParseError`, `AddFileConflictError`, `FileNotFoundError`, `HunkNotAppliedError`, `DeleteNotSupportedError`, `MoveSourceCleanupError`
  - pure `computeUpdatedContent` helper
- `src/apply.ts` — Cordis `apply(ctx, config)` body: resolves `ctx.fs.writeText/readText` behind a `PatchFileBackend`, falls back to `ctx.shell` for delete, registers the `apply_patch` model-facing tool with `defineTool`. The verbatim codex-rs prompt template lives in `apply_patch_tool_instructions.md` at the package root and is loaded at apply time via `readFile(import.meta.url)`. The file is a condensed paraphrase of `codex-rs/apply-patch/src/lib.rs` `APPLY_PATCH_TOOL_INSTRUCTIONS`; the verbatim upstream grammar spec lives in `codex-rs/apply-patch/apply_patch_tool_instructions.md` and is tracked as a follow-up.
- `src/streaming-parser.ts` — incremental `StreamingPatchParser` factory (`createStreamingPatchParser()`) mirroring `codex-rs/apply-patch/src/streaming_parser.rs`. `pushDelta(delta)` walks the delta one code-point at a time, accumulating a `lineBuffer` until `\n`; trailing `\r` is stripped so CRLF inputs parse identically to LF. `processLine` dispatches on the active `mode` (`notStarted` / `startedPatch` / `addFile` / `deleteFile` / `updateFile` / `endedPatch`) and emits the same `ParseError` wording as the Rust reference. `finish()` flushes any trailing buffered line and asserts the parser ended in `EndedPatch`.
- `src/index.ts` — re-exports the data-plane API and exposes Cordis plugin metadata (`name`, `inject`)

Verified on 2026-08-25 (round 6) with keyless tests driven from the host
`node_modules\.bin\tsx.cmd`:

```
tests/parser.spec.ts          8 passed
tests/seek-sequence.spec.ts   9 passed
tests/apply-core.spec.ts     19 passed   (data-plane core, MemBackend)
tests/integration.spec.ts     9 passed   (real node:fs/promises via NodeFsBackend)
tests/streaming-parser.spec.ts 21 passed  (mirrors codex-rs streaming_parser.rs mod tests)
                            -- 66 total -- keyless, no DEEPSEEK_API_KEY
```

The integration suite mirrors four codex-rs scenarios in
`codex-rs/apply-patch/tests/fixtures/scenarios/` (001, 003, 004, 020) plus
the round-3 mixed Add/Update/Delete scenario and the parse-error path.
Fixture bodies are inlined so the suite stays portable across machines.

Still pending the next rounds:

- `pnpm install` in the worktree root, so `apply.ts` can resolve `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-fs` and the live tool execution path (currently the file is exercised statically only — typecheck via `tsx` works).
- Snapshot test against the assembled CLI (needs `DEEPSEEK_API_KEY`).
- `apply_patch_tool_instructions.md` lives at the package root and is loaded at apply time; the inline constant in `apply.ts` is gone. The file content is a condensed paraphrase (round 7); pulling the verbatim codex-rs grammar spec is tracked as a separate round.

## Why this matters

`packages/fs` ships `tool-fs` (read/write/edit) and `tool-str-replace-editor`
(view/create/str_replace) but no `apply_patch`. Codex''s flagship model-facing
patch format — used by gpt-4.1 and downstream consumers — has no harness
equivalent, so every harness agent that wants to mirror codex behaviour has
to hand-roll its own driver. This package fills that gap on the public
`ctx.fs` seam.

## Streaming vs. whole-string

`src/parser.ts` consumes the full patch string in one `parsePatch(...)`
call. `src/streaming-parser.ts` accepts arbitrary UTF-8 deltas via
`createStreamingPatchParser()` and surfaces every committed hunk as
soon as it finalises, so the runtime can drive the file-system
pipeline mid-stream instead of waiting for the chunk boundary — useful
when model output is delivered one token at a time. The interface and
error wording match `codex-rs/apply-patch/src/streaming_parser.rs`
line-for-line, including CRLF normalisation, EOF marker placement, and
the bare-empty-update-line carve-out.

## Layout mirror

| codex-rs file          | dsh port                 | status                                       |
|------------------------|--------------------------|----------------------------------------------|
| `parser.rs`            | `src/parser.ts`          | ported + tested                              |
| `markers` (in parser)  | `src/markers.ts`         | ported + tested                              |
| `seek_sequence.rs`     | `src/seek-sequence.ts`   | ported + tested (4 passes)                   |
| `lib.rs`               | `src/apply-core.ts`      | ported + tested (HunkOutcome + typed errors) |
| `lib.rs` (apply ctx)   | `src/apply.ts`           | ported (defineTool + ctx.fs/shell bridge)    |
| `streaming_parser.rs`  | `src/streaming-parser.ts`| ported + tested (21/21, codex-rs mod tests) |
| `invocation.rs`        | n/a (no shell-driver bin) | out of scope -- shell-driver is codex-specific |
