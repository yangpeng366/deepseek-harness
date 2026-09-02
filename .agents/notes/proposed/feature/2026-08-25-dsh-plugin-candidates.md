# Agent Note: dsh plugin candidates — closing the codex capability gap

Status: proposed

English | [中文](2026-08-25-dsh-plugin-candidates.zh.md)

## Problem

`@deepseek-ai/dsh` ships as `0.1.1-rc.2` on both the `latest` and `next` npm dist-tags as of 2026-08-25. The local HEAD (`b150a551b8`) equals upstream, so there is no new version to upgrade to. Local adoption is gated by feature parity with `codex-rs`: users who evaluate dsh next to Codex look for codex capabilities the current release does not offer. Three gaps drive the comparison:

- Editing tool surface. dsh ships `tool-str-replace-editor` (Aider-style view / str_replace / insert) and never the codex `apply_patch` (`*** Begin Patch … *** End Patch`) format. Models tuned on Codex instruction sets fall back to less efficient patches.
- Persistent memory across sessions. codex owns `memories` and `message-history` as first-class crates; dsh only has `compaction` plus one MCP example under `examples/mcp-memory/`.
- Telemetry export. codex ships `otel` and `analytics`; dsh only emits session JSONL through `runtime-diagnostics`, with no OTLP sink.

The remaining gap rows (`windows-sandbox-rs`, `dynamic-plugin-loader`, `cloud-tasks`, `connectors`, `realtime-webrtc`) are larger seams and need either new core services or external coordination, so they stay in P1 or P2.

This proposal captures the candidates, ranks them by gap size and seam ownership, and sets acceptance criteria for each P0 entry. Implementation is staged across separate worktrees and PRs; this note is the inventory and the contract, not the change set. The supporting gap analysis lives at `D:\BaiduSyncdisk\Obsidian Vault\当前项目\02_项目推进\dsh-vs-codex-gap-2026-08-24.md`.

## Proposal

The P0 candidates each ship as one new package, reusing an existing seam and one existing test harness. They do not modify `packages/core`, `packages/session`, or any cordis-registered core service.

### P0-1 `packages/fs/tool-apply-patch` — codex `apply_patch` data plane

A model-facing `apply_patch` tool that consumes the codex patch format and dispatches to `packages/fs` through the existing `ctx.fs` write-intent gate. The tool sits next to `tool-str-replace-editor`; models may use either. Already in flight on the `dsh-apply-patch-2026-08` branch (`F:\github\dsh-experiments\apply-patch-2026-08`, HEAD `3991e1f693`, round 6).

- Parser / seek-sequence / streaming-parser / apply-core: ported from `codex-rs/apply-patch/`. 66 keyless tests pass under `npx tsx tests/*.spec.ts` (`parser 8/8`, `seek-sequence 9/9`, `apply-core 19/19`, `integration 9/9`, `streaming-parser 21/21`).
- Pending: wire `apply.ts` to `defineTool` + `ctx.inject`; extract `APPLY_PATCH_TOOL_DESCRIPTION` to `apply_patch_tool_instructions.md`; record one snapshot under `examples/agent-spine` once `DEEPSEEK_API_KEY` is set.
- The PR goes to `deepseek-harness/deepseek-harness` once the user confirms push; round 1 → round 6 history is one linear chain.

### P0-2 `packages/extensions/bundle-otel-exporter` — OTLP sink for `runtime-diagnostics`

A bundle that registers one optional sink against `ctx.diagnostics`. The bundle exports session JSONL events plus summary counters to an OTel Collector over gRPC or HTTP, configurable by cordis.yml overlay.

- New package only; no edits under `packages/core/`, `packages/runtime-diagnostics/`, or `packages/observability/`.
- Imports the OTel JS SDK as a peerDependency so the SDK stays out of the core dependency graph.
- The provider ships with a no-op default so the bundle is opt-in.

### P0-3 `packages/extensions/memories` — long-term memory seam

A first-class memory seam that mirrors `codex-rs/memories`. The seam is one `ctx.memories` interface and one filesystem provider (`memories-filesystem`) that writes to `~/.dsh/memories/<profile>/`. The current `examples/mcp-memory` overlay (Memorix / reference-memory / Engram) becomes one optional provider each, not the only path.

- The seam lives in a new package; the provider lives next to it. Existing `compaction` and `session` packages stay unchanged.
- A new `memory_recall` model-facing tool surfaces recall to the next turn; it does not change session log format.
- Persistence is per profile and per scope, with explicit consent recorded through `interaction/approval`. The model never writes to durable memory without one explicit user-acknowledged call.

### P1 — carry into the next proposal cycle, not this PR

- `dsh-tool-request-permissions` — model-side `RequestPermissionsTool` plus `RequestRule`, lands in `packages/interaction/`. Needs a new `ctx.permissions.request` interface, so a small architecture note first.
- `dsh-bundle-windows-sandbox` — Windows-native sandbox mirror of `codex-rs/windows-sandbox-rs`. An independent worktree cannot run a Windows verifier; the deliverable is RFC plus reference implementation.
- `dsh-bundle-dynamic-plugin-loader` — runtime install path parallel to `codex-rs/plugin/`. Composes with `extensions/`, `bundle/`, and the new permissions seam above; not safe to start without it.
- `dsh-web-tui-bridge` — optional TUI surface for the Web UI, reusing `packages/host`. Driven by OpenEyes and patrol workflows.

#### Next-cycle ranking from the refreshed Codex inventory

The following order is a proposal for the next comparison cycle, not an implementation commitment. It uses the refreshed `codex-rs` evidence recorded in [the mirror-refresh note](../process/2026-08-29-dsh-codex-parity-mirror-refresh.md), while keeping the existing P0 work unchanged:

1. `dsh-context-fragments` — lowest-cost model-visible addition. It can add typed developer/user fragments to `packages/context/` without a native dependency, but must define how annotations are retained in prompt reconstruction.
2. `dsh-preset-roles` — role-file discovery and merge for `packages/preset/`. The seam is useful and bounded, but its precedence rules must be specified before implementation because it overlaps preset composition.
3. `dsh-prompt-templates` — reusable, profile-scoped prompt templates for `packages/core/system-prompt/`. It improves downstream overrideability, but template ownership and model-visible logging must be settled before templates become configurable.
4. `dsh-workload-identity` — file-backed identity exchange near `packages/credentials/`. It is valuable for deployment integration, but requires a threat model and explicit token-lifetime and file-permission rules.
5. `dsh-code-mode` — retain as P2 research. In-process V8 execution is the largest implementation and distribution risk for dsh's TypeScript/ESM and native-addon stance.
6. `dsh-model-history` — retain as P2 research. The domain may complement `packages/session/` and `packages/compaction/`, but the ownership split is not yet clear enough to rank above the other candidates.

`guardian-review` is not ranked: the refreshed Codex source contains no corresponding `guardian-context` seam, so any dsh implementation would be a new consent design rather than a parity port.

### P2 — research only

- `dsh-bundle-cloud-tasks` — `codex-rs/cloud-tasks` mirror. Needs `api/` plus `sdk/` alignment.
- `dsh-bundle-connectors` — OAuth connector directory. Couples to `credentials/` and `settings/`; privacy review first.
- `dsh-realtime-webrtc` — audio and video realtime channel. Outside the current Web UI shape.

## Alternatives considered

### **Vendor `codex-rs` as a runtime dependency and call into it through FFI**

Rejected. dsh runs TypeScript ESM; codex-rs runs Rust. FFI between them costs the dependency-update discipline dsh already avoids. The capability seam stays in dsh; porting Rust to TS deletes the cross-language boundary and the cross-process coordination layer that comes with it.

### **Fork dsh and ship a parallel release under a different name**

Rejected. The repository record marks "Pre-release stance: foundation over blast radius — rename or repackage freely". A fork fixes the gap for one user and abandons the rest. The proposal contributes the candidates back to the source repo instead.

### **Do nothing until upstream tags a stable release**

Rejected. The gap is what users compare against today. Stalling does not close it. The P0 list is the minimum that makes dsh an evaluation peer of codex on the current `0.1.1-rc.2`.

### **Land the candidates inside `packages/core` rather than as new packages**

Rejected. The project rule "Plugins, not loop changes: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md" treats `packages/core` as a separate layer. New packages keep the surface stable and make the PR reviewable against one seam at a time.

## Acceptance criteria

- `pnpm run build` and `pnpm run verify-package-invariants` pass in the worktree after each P0 package is scaffolded, with no edits under `packages/core/`, `packages/session/`, `packages/runtime-diagnostics/`, or `packages/observability/`.
- P0-1: `packages/fs/tool-apply-patch` exports one `apply_patch` tool; the 66 existing tests remain green; the new `apply_patch_tool_instructions.md` is referenced from the tool description; one snapshot under `examples/agent-spine` covers an end-to-end patch transcript using a real model.
- P0-2: `packages/extensions/bundle-otel-exporter` registers one optional sink; with no `OTEL_EXPORTER_OTLP_ENDPOINT` set the bundle is a no-op; with the endpoint set, every `runtime-diagnostics` event and one session summary counter arrive at the collector within 5 s.
- P0-3: `packages/extensions/memories` exposes `ctx.memories`; the filesystem provider round-trips one record under `~/.dsh/memories/<profile>/`; the `memory_recall` tool returns scoped records for the active session; consent is recorded through `interaction/approval` and the model cannot bypass it.
- All three P0 entries add one `implemented/feature/<date>-…md` Agent Note in the same PR, pair a `.zh.md` counterpart, and update `scripts/agent-note-tree.ts` only if a new class is needed.
- The Chinese counterpart mirrors this file section-for-section under the [i18n contract](../../../docs/i18n/README.md); `pnpm run verify-translation-pairing --write` records the sidecar blob hashes.

## Risks

The `0.1.x` branch is still pre-release. Patches against `core`, `session`, or `compaction` will collide with the `0.1.2-rc` refactor tracked by `feature/image-management-strategy`. The proposal sidesteps the risk by limiting itself to new packages; new packages do not absorb upstream API churn until they ship as overlays, and overlays sit behind cordis.yml.

P0-1's `apply_patch` coexists with `tool-str-replace-editor`. If both tools are advertised for the same session, the model may pick one and the UI may render the other. Mitigation: `apply.ts` accepts only `apply_patch`; the editor accepts only str_replace; both write through `ctx.fs` write-intent; the registry disallows opening the same path through both tools in one turn.

P0-3's persistent memory affects behavior across sessions. If the model writes a sensitive entry by mistake, the entry persists. Mitigation: per-profile isolation, per-scope namespaces, mandatory `interaction/approval` on the first write per session, and a `dsh memory prune` console command that walks the active profile.

The OTel sink in P0-2 may surface session content to a third party if the collector endpoint is misconfigured. The bundle defaults to `127.0.0.1:4317` and refuses to start when the endpoint is `0.0.0.0` or a public hostname without an explicit `--allow-external` flag in the cordis.yml overlay.

Pushing the P0 PRs without explicit user confirmation breaches the autonomy contract recorded in the patrol row. Round 6 of the apply-patch worktree already lays down the first candidate; the push gate stays on the user side.
