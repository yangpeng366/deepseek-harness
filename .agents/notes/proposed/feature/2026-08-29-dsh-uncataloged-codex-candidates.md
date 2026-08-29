# Agent Note: dsh uncataloged codex-rs candidates - extending the parity inventory

Status: proposed

English | [中文](2026-08-29-dsh-uncataloged-codex-candidates.zh.md)

## Problem

The parity inventory at [2026-08-25-dsh-plugin-candidates](2026-08-25-dsh-plugin-candidates.md) ranks ten codex-rs surfaces as P0/P1/P2 (`apply-patch`, `otel`, `memories`, `windows-sandbox-rs`, `dynamic-plugin-loader`, `cloud-tasks`, `connectors`, `realtime-webrtc`, plus `collaboration-mode-templates` from the [presets note](2026-08-26-dsh-collaboration-presets.md)). The codex-rs workspace ships roughly ninety crates; the inventory cataloged the ones with the largest user-visible gap and left the rest implicit. A crate-by-crate pass over `codex-rs/` found eleven more crates that represent real capability seams dsh does not own today. They are not blocked by the pending push-execution kit ([2026-08-28 verification](../process/2026-08-28-dsh-push-readiness-verification.md)); they are research candidates the next proposal cycle can pick up.

This note extends the inventory. It does not change P0-1/P0-2/P0-3 or the four preset PRs already waiting on the user push decision.

## Discovery

Each row below names the codex-rs crate, its purpose read from `src/lib.rs`, the dsh gap, and a proposed candidate package. Priorities extend the existing P1/P2 bands; none of these is P0 because each needs either a new core interface or external coordination before it can ship as an overlay.

| codex-rs crate | purpose | dsh gap | candidate | priority |
|---|---|---|---|---|
| `codex-git-utils` | git operations: `apply_git_patch`, `stage_paths`, `extract_paths_from_patch`, branch/baseline/info | no first-class git seam; P0-1 `tool-apply-patch` writes through `ctx.fs` but never stages | `dsh-bundle-git` (`ctx.git`) | P1 |
| `codex-rmcp-client` | full MCP client: OAuth discovery (`StreamableHttpOAuthDiscovery`), elicitation client service, streamable HTTP + stdio process transport | dsh consumes MCP servers but ships no full client with OAuth/elicitation transport | `dsh-rmcp-client` | P1 |
| `codex-builtin-mcps` | catalog of product-owned built-in MCP servers (`MEMORIES_MCP_SERVER_NAME`); runtime placement owned by `codex-mcp` | only `examples/mcp-memory`; no product-owned built-in catalog | `dsh-bundle-builtin-mcps` | P1 |
| `codex-secrets` + `codex-keyring-store` | git-repo-root-scoped secret storage over an OS `KeyringStore`; JSON-schema-described entries | `packages/credentials` ships env/.env only; no OS keyring | `dsh-bundle-keyring` | P2 |
| `codex-network-proxy` | HTTP/SOCKS5 MITM proxy with cert handling, `connect_policy`, `network_policy` | no proxy seam; remote-ingress docs exist but no programmatic proxy | `dsh-bundle-network-proxy` | P2 |
| `codex-responses-api-proxy` | standalone TCP proxy serving the responses API | `packages/api` assembles the BFF but ships no standalone responses-API proxy | `dsh-responses-api-proxy` | P2 |
| `codex-thread-store` | storage-neutral thread persistence keyed by `ThreadId` (in-memory, live, local) | `packages/session` owns persistence; the thread concept is not first-class | `dsh-thread-store` | P2 |
| `codex-external-agent-sessions` | parse and export external-agent session histories (detect, ledger, records) | session projection exists; no external-agent interop export | `dsh-external-agent-sessions` | P2 |
| `codex-feedback` | feedback/telemetry channel tied to `AuthEnvTelemetry` | `runtime-diagnostics` emits JSONL; no structured feedback channel | `dsh-bundle-feedback` | P2 |
| `codex-process-hardening` | pre-main hardening: disable core dumps, ptrace attach, scrub `LD_PRELOAD`/`DYLD_*` | `packages/guard` covers loop hygiene; no native process hardening | `dsh-process-hardening` (native) | P2 |
| `codex-terminal-detection` | terminal metadata feeding OTel user-agent and TUI config | none; folds into the P1 `dsh-web-tui-bridge` | (folded) | P2 |

## Proposal

Stage these eleven rows as the long tail of the parity inventory. Carry the three P1 rows into the next proposal cycle; leave the eight P2 rows as research-only until a P1 lands.

- `dsh-bundle-git` is the highest-leverage P1: `tool-apply-patch` already writes file content; adding `ctx.git.stage(paths)` closes the loop from patch to commit without a new core service. The seam reuses `packages/fs` write-intent and `packages/subprocess` for the git binary; it does not touch `packages/core`.
- `dsh-rmcp-client` and `dsh-bundle-builtin-mcps` form one dependency pair: a richer MCP client lets built-in servers register transport (OAuth, elicitation, streamable HTTP) without per-server glue. Land the client first; the catalog follows.
- The eight P2 rows each need an architecture decision (new interface or external coordination) before a package skeleton. They stay research-only here; no worktree yet.

## Alternatives considered

- **Roll every crate into one mega-PR.** Rejected. Each P1 is one seam; the existing rule "Plugins, not loop changes" plus "one PR per seam" keeps review tractable. The P0 RFC already established the per-package shape.
- **Treat `rollout` and `terminal-detection` as separate candidates.** `rollout` (`state_db`, `session_index`) overlaps `packages/session` projection and the P0-2 OTel sink; `terminal-detection` folds into the TUI. Calling them out as separate packages adds inventory noise without a new seam.
- **Defer until the push gate clears.** Rejected. These are research rows; cataloging them now lets the next proposal cycle pick a P1 the moment the user signs off on the push, instead of re-running the crate pass.

## Acceptance criteria

- This note and its Chinese counterpart are paired under the [i18n contract](../../../docs/i18n/README.md); the sidecar blob hashes are recorded.
- A future P1 proposal (`dsh-bundle-git`, `dsh-rmcp-client`, or `dsh-bundle-builtin-mcps`) cites this row as the source of the gap and links back to the codex-rs crate path it ports from.
- The eight P2 rows stay in this note until promoted; promoting one moves it to a dedicated `proposed/feature/<date>-…md` note, not an inline edit here.

## Risks

The codex-rs crate purposes were read from `src/lib.rs` module lists and doc comments at the on-disk checkout (`E:\AI-Portable\repos\codex\codex\codex-rs`). A crate's exported surface may be larger or smaller than the module list implies; a real port reads the full public API and the tests before scoping a package. Priorities are advisory, not a commitment.

`dsh-bundle-git` and `dsh-rmcp-client` touch external binaries (git, MCP server processes) that the dsh test harness does not pin. A port must declare those as test-skip boundaries, not assume they are present.

## Push gate

This note is local only. It does not join the four feature-branch PRs or the master-delta PR waiting on the user push decision; the push-execution kit in [2026-08-28 verification](../process/2026-08-28-dsh-push-readiness-verification.md) stays the next executable side effect, and it stays gated on the user.