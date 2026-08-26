# Agent Note: dsh collaboration presets — codex collaboration-mode parity

Status: proposed

English | [中文](2026-08-26-dsh-collaboration-presets.zh.md)

## Problem

The master RFC [2026-08-25-dsh-plugin-candidates](2026-08-25-dsh-plugin-candidates.md) catalogs dsh gaps versus codex at the capability-seam level (new packages: P0-1 `tool-apply-patch`, P0-2 `bundle-otel-exporter`, P0-3 `memories`). A separate codex surface — `codex-rs/collaboration_mode` and its CLI presets (`default`, `plan`, `execute`, `pair_programming`) — was not captured because `packages/preset/` already accepts arbitrary `preset.yml` files. The gap is therefore not a missing package but a missing **named bundle** the user can pick from the CLI at session start.

## Discovery

A new worktree `dsh-collaboration-presets-2026-08` at `F:\github\dsh-experiments\dsh-collaboration-presets-2026-08`, HEAD `bfa855ca1f`, implements four collaboration presets that mirror codex's named modes one-for-one under `apps/cli/config/agent-presets/`:

- `co-default/` — read-only default. Exposes only `tool-fs` (readOnly) / `tool-fs-search` / `tool-skill`. Behavior contract: read before answer; never mutate the worktree.
- `co-plan/` — plan mode. Same read-only surface as `co-default` plus a written plan output. Behavior contract: produce a written plan; await explicit user approval before any tool that mutates state.
- `co-execute/` — execute mode. Exposes `tool-bash` (Linux/macOS) / `tool-pwsh` (Windows) / `tool-fs` / `tool-fs-search` / `tool-apply-patch` / `tool-jobs` / `tool-skill`. Explicitly disables `subagent` to keep the execution chain linear. Behavior contract: execute the approved plan; on any blocked tool, return immediately with `blocked` and a one-line ask.
- `co-pair/` — pair-programming mode. Same tools as `co-execute` minus `tool-jobs`. Explicitly disables `web_search` / `subagent`. Behavior contract: each step requires a one-line rationale; pause to confirm when the next move is unclear.

Each preset ships three files: `agent.cordis.yml` (composition), `preset.yml` (name / description / order), and `README.md` (tool whitelist + behavior contract). Total: 12 files / +228 lines on `bfa855ca1f`.

## Why this is a codex parity gap

`codex-rs/collaboration_mode.rs` exposes the four named modes as a CLI enum the user picks before each session. dsh has no equivalent CLI affordance today; `packages/preset/` accepts arbitrary `preset.yml` files but does not ship codex-named presets out of the box. The presets in the new worktree close that gap.

The presets do not require a new package. They compose existing cordis plugins (`@deepseek-ai/dsh-persona`, `@deepseek-ai/dsh-agent-instructions`, `@deepseek-ai/dsh-tool-fs`, `@deepseek-ai/dsh-tool-fs-search`, `@deepseek-ai/dsh-tool-skill`, `@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-pwsh`, `@deepseek-ai/dsh-tool-apply-patch`, `@deepseek-ai/dsh-tool-jobs`) following the existing `preset.yml` convention. No edits under `packages/preset/`, `packages/core/`, `packages/session/`, or `packages/runtime-diagnostics/` are required.

## Proposal

Land the four presets as one standalone commit on master. The commit sits at `apps/cli/config/agent-presets/co-{default,plan,execute,pair}/`, parallel to any other presets already in that directory. No edits under `packages/preset/`.

Acceptance criteria:

- `pnpm run verify-cordis-config` passes against the four new `agent.cordis.yml` files; the resolver manifest for each one lists its dependencies.
- The four preset names map 1:1 to codex named modes; the CLI help output exposes them as `--preset co-default|co-plan|co-execute|co-pair`.
- One snapshot under `examples/agent-spine` covers a `--preset co-plan` session that produces a written plan and refuses to mutate state.
- One snapshot under `examples/agent-spine` covers a `--preset co-execute` session that executes an approved plan and does not expose `subagent`.

## Risks

The presets depend on `tool-apply-patch`, which sits in P0-1 of the master RFC. Until P0-1 lands, `co-execute` and `co-pair` reference a plugin that is not on disk; the cordis resolver will fail at load. Mitigation: gate `co-execute` and `co-pair` behind the same overlay that registers `tool-apply-patch`, or accept that those two presets only resolve once P0-1 ships.

The four presets do not yet cover `codex-rs::collaboration_mode::Migrate` (a codex-only migration helper). If users hit that mode they must use a custom preset. The four presets are not a complete parity list; they cover the modes that have a clear dsh analog.

The CLI `--preset` flag is not yet surfaced in `apps/cli/`. The presets can be loaded by name through `preset.yml`, but a user picking from the CLI requires a follow-up patch to the CLI bin. Acceptance criterion 2 names that follow-up explicitly.

## Push gate

This note accompanies the local commits; the push gate stays on the user side per the patrol autonomy contract. The new worktree HEAD `bfa855ca1f` should be folded into the same push-sequence decision the user is currently considering for the other four dsh worktrees (`dsh-apply-patch-2026-08`, `master` RFC, `dsh-upgrade-2026-08`, `dsh-upstream-doc-2026-08`).