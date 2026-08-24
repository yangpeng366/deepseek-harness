# @deepseek-ai/dsh-tool-apply-patch

Model-facing `apply_patch` tool for DeepSeek Harness — a TypeScript port of
[`codex-rs/apply-patch`](https://github.com/openai/codex/tree/main/codex-rs/apply-patch).

## Status (2026-08-24, round 3)

Two of the four upstream Rust modules are now ported and tested:

- `src/markers.ts` — verbatim marker constants from the codex reference
- `src/types.ts` — `Hunk`, `UpdateFileChunk`, `ApplyPatchArgs`, `ParseError`, `ParseMode`
- `src/parser.ts` — `parsePatch(patch, mode)` with strict + lenient (heredoc-aware) modes
- `src/seek-sequence.ts` — fuzzy line locator with four passes (exact / trimEnd / trim / Unicode-normalise), mirroring `seek_sequence.rs`
- `src/index.ts` — re-exports + Cordis plugin metadata (`name`, `inject`)

Verified on 2026-08-24 with keyless tests driven from the host `node_modules\.bin\tsx.cmd`:

```
tests/parser.spec.ts          8 passed
tests/seek-sequence.spec.ts   9 passed
```

Still pending the next rounds:

- `src/streaming-parser.ts` — incremental line-buffer parser mirroring `streaming_parser.rs`. Optional: only needed when the agent streams patch input instead of receiving one big string.
- `src/apply.ts` — Cordis `apply(ctx, config)` body that registers the tool via `defineTool`, normalises paths, and dispatches each `Hunk` to `ctx.fs.write / read / delete` through `FsWriteIntent`. This is the live tool wiring; it depends on `ctx.fs`, `ctx.tools`, `ctx.systemPrompt` being present in the worktree (requires `pnpm install`).
- Snapshot test against the assembled CLI (needs `DEEPSEEK_API_KEY`).
- `apply_patch_tool_instructions.md` (verbatim from codex-rs/apply-patch) should be embedded into the tool description so model-side prompting stays aligned with the upstream prompt template.

## Why this matters

`packages/fs` ships `tool-fs` (read/write/edit) and `tool-str-replace-editor`
(view/create/str_replace) but no `apply_patch`. Codex's flagship model-facing
patch format — used by gpt-4.1 and downstream consumers — has no harness
equivalent, so every harness agent that wants to mirror codex behaviour has
to hand-roll its own driver. This package fills that gap on the public
`ctx.fs` seam.

## Layout mirror

| codex-rs file          | dsh port                 | status                                       |
|------------------------|--------------------------|----------------------------------------------|
| `parser.rs`            | `src/parser.ts`          | ported + tested                              |
| `markers` (in parser)  | `src/markers.ts`         | ported + tested                              |
| `seek_sequence.rs`     | `src/seek-sequence.ts`   | ported + tested (4 passes)                   |
| `streaming_parser.rs`  | `src/streaming-parser.ts`| pending                                      |
| `invocation.rs`        | `src/apply.ts`           | pending (`defineTool` + `ctx.fs` bridge)     |
| `lib.rs`               | `src/index.ts`           | ported (re-exports + metadata)               |
