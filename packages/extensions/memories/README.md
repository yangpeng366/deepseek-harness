# @deepseek-ai/dsh-memories

English | [中文](README.zh.md)

First-class memory seam mirroring `codex-rs/memories`. The seam is one `ctx.memories` interface and one filesystem provider (`memories-filesystem`) that writes to `~/.dsh/memories/<profile>/`. Existing `examples/mcp-memory` overlays (Memorix, reference-memory, Engram) become optional providers, not the only path.

## Status

Scaffold only. The package shape is fixed; the implementation lands behind this contract.

## What it does (when implemented)

- Registers `ctx.memories` with a `recall(scope, query)` and a `record(scope, entry)` surface.
- The default filesystem provider round-trips one record under `~/.dsh/memories/<profile>/<scope>/`.
- A new `memory_recall` model-facing tool surfaces recall to the next turn; it does not change session log format.
- Persistence is per profile and per scope, with explicit consent recorded through `interaction/approval`. The model never writes to durable memory without one explicit user-acknowledged call.
- The MCP overlays under `examples/mcp-memory` remain; each becomes one optional provider each, not the only path.

## Storage stance

Durable on disk under the active profile. The provider refuses to write outside `~/.dsh/memories/<profile>/` and refuses to switch profiles without an explicit user-acknowledged call.

## Trust stance

Sensitive entries persist. Per-profile isolation, per-scope namespaces, mandatory `interaction/approval` on the first write per session, and a `dsh memory prune` console command that walks the active profile are the layered guards. The model never bypasses consent.

## Export shape

Seam package: default-exports the `MemoriesService` (service key `memories`); `./filesystem` exports the default provider. The `memory_recall` tool is registered alongside the service.

## Acceptance criteria (mirrored from the proposal note)

- `pnpm run build` and `pnpm run verify-package-invariants` pass after the package is implemented, with no edits under `packages/core/`, `packages/session/`, `packages/runtime-diagnostics/`, `packages/observability/`, `packages/compaction/`.
- `ctx.memories` exposes `recall` and `record`; the filesystem provider round-trips one record under `~/.dsh/memories/<profile>/`; the `memory_recall` tool returns scoped records for the active session.
- Consent is recorded through `interaction/approval`; the model cannot bypass it.
- One `implemented/feature/<date>-…md` Agent Note pairs a `.zh.md` counterpart and updates `scripts/agent-note-tree.ts` only if a new class is needed.