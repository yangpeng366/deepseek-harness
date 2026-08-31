# Agent Note: dsh codex-parity mirror refresh - corrected candidate seams

Status: proposed

English | [中文](2026-08-29-dsh-codex-parity-mirror-refresh.zh.md)

## Problem

The 2026-08-25 plugin-candidates note and the 2026-08-26 collaboration-presets note compared dsh against the local codex source mirror at `E:\AI-Portable\repos\codex\codex`. A 2026-08-29 patrol fetch found that mirror stale: its local working-tree HEAD sat at `789b7e39dc` (2026-05-09), so every parity claim in those notes was measured against a snapshot roughly three and a half months old. The fetch updated the `origin/main` remote-tracking ref; a 2026-08-31 recheck finds it further advanced to `51ebf5b184` ("Truncate Guardian instructions after rendering the policy", #39985). The local working branch was not advanced and still sits at `789b7e39dc`, so crate-level claims here are verified against `origin/main`, not the checked-out tree. A 2026-08-31 pass counts 141 `Cargo.toml` files under `codex-rs/`.

This note records the new capability seams the refreshed `origin/main` exposes, then corrects two seams a 2026-08-31 verification could not substantiate. It folds the survivors into the P0/P1/P2 ranking only after the flagged overlap and implementation-cost questions are resolved.

## Proposal

Record the crate- and module-level seams and their candidate dsh seams as evidence for the next proposal cycle. Withdraw `guardian-context`, which no path in `codex-rs/` substantiates. Fold the survivors into the P0/P1/P2 ranking only after the flagged overlap and implementation-cost questions are resolved.

## Findings

A 2026-08-31 verification audited every claimed seam against `origin/main` (`51ebf5b184`): the standalone-crate status of each was confirmed, and the export lists of `prompts` and `agent-roles` were read directly from source. Four of the six proposed seams are confirmed standalone crates; one is a module inside the `core` crate; `guardian-context` is withdrawn.

### agent-roles - module inside `core`, not a standalone crate

A recursive search of `codex-rs/` finds no `agent-roles` crate. The surface lives at `codex-rs/core/src/config/agent_roles.rs` and `codex-rs/core/src/context/multi_agent_role_instructions.rs`, inside the `core` crate. The real exports are `AgentRoleConfig` (a type) and `load_agent_roles`, a `pub(crate)` async loader that reads role files from a configurable directory and merges them across a `ConfigLayerStack`; `load_agent_roles_without_layers` and `merge_missing_role_fields` are crate-internal helpers. The earlier draft's `ResolvedAgentRoleFile` and `parse_agent_role_file_contents` do not appear in the file. dsh `preset/` does per-session composition from `cordis.yml` but has no role-file discovery loader; a user must name each plugin explicitly. Candidate dsh package: a `preset-roles` overlay that scans a profile-scoped role directory and registers each file as a per-session preset. The overlap with `preset/` is real, but the discovery + resolution step is distinct. A port extracts the loader from `core`, not a crate swap.

### context-fragments - annotated context model

Confirmed standalone crate. Exports `AdditionalContextDeveloperFragment`, `AdditionalContextUserFragment`, `AnnotatedContent`, `set_annotated_content`, `ContextualUserFragment`, and `RenderedFragment`. The seam types a developer/user split inside the context window and attaches annotations to rendered fragments. dsh `context/` registers request-context plugins but has no fragment/annotation render model; content reaches the prompt as composed strings. Candidate dsh package: a `context-fragments` plugin that types fragments before assembly so the system prompt can distinguish developer annotations from user content.

### code-mode-runtime - in-process V8 code execution

Confirmed standalone crate. Exports `InProcessCodeModeSession`, `V8JitMode`, and `initialize_v8`, plus re-exports from `code-mode-protocol`. The runtime hosts cell actors and session runtimes inside a V8 isolate. This is the largest novel gap: dsh `subprocess/` and `shell/` run code out-of-process through platform binaries, and `plan/` mode is a logged plan state, not an execution sandbox. The existing `v8-poc` crate in the prior inventory was a proof of concept; `code-mode-runtime` is the productionized version. Candidate dsh package: a `code-mode` plugin using the existing `node-addon-landlock-run` native addon as the V8 host. Complexity is the highest of the survivors because it requires a native V8 build and a sandbox policy; flagged as the highest-effort candidate.

### workload-identity - file-backed identity token exchange

Confirmed standalone crate. Exports `WorkloadIdentityExchange` and `WorkloadIdentityToken` with an assertion-exchange module. The crate reads a file-backed assertion, exchanges it for a ChatGPT auth token, and returns the token to the caller. dsh `identity/` generates an anonymous identity; `credentials/` reads from env or `.env`. Neither performs workload-identity token exchange. Candidate dsh package: a `workload-identity` provider under `credentials/` that accepts a file-backed assertion and exchanges it through a configured OIDC endpoint. Consent and endpoint validation are prerequisites before any token flow ships.

### prompts - shared prompt-template library

Confirmed standalone crate. `codex-rs/prompts/src/lib.rs` re-exports `SUMMARIZATION_PROMPT`, `SUMMARY_PREFIX` (not `SUMMARIZATION_PREFIX`), `PermissionsInstructions`, `ApprovalPromptContext`, `BACKEND_PROMPT`, `END_INSTRUCTIONS`, plus `START_INSTRUCTIONS`, the `goals` prompts (`budget_limit_prompt`, `continuation_prompt`, `objective_updated_prompt`), and the review surface (`REVIEW_PROMPT`, `ResolvedReviewRequest`, `resolve_review_request`, `render_review_exit_success`, `render_review_exit_interrupted`). The crate also ships a `templates/` directory of markdown and xml files grouped by flow (`compact/`, `goals/`, `permissions/approval_policy/`, `permissions/sandbox_mode/`, `realtime/`, `review/`) loaded at runtime, not just typed constants. dsh `system-prompt/` composes the system prompt from plugin contributions but has no shared template library; each plugin owns its own strings. Candidate dsh package: a `prompt-templates` plugin that ships template files under a profile-scoped directory and exposes typed slots so downstream bundles can override individual prompts without editing source.

### guardian-context - withdrawn

Withdrawn. A 2026-08-31 recursive search of `codex-rs/` found no `guardian-context` crate or module (zero path matches for `guardian_context` or `guardian-context`). The "Guardian" concept appears only as `app-server-protocol` schema files (`GuardianWarningNotification.json`, `GuardianApprovalReview.ts`, and the `ThreadApproveGuardian*` family), not as a context crate. The earlier draft's quoted "module doc" was unverifiable. The dsh-side `guardian-review` hypothesis is retained only as a product idea with no codex-rs source to port; it needs an explicit consent design before any model-facing work.

### history - model-history and persisted-rollout domain

Confirmed standalone crate. The module doc states it: model-history and persisted-rollout domain types. dsh `session/` and `compaction/` cover durable persistence and compaction; this crate adds a model-facing history domain on top. The overlap with existing persistence is larger than the other survivors, so the candidate stays in the research bucket until the domain boundary is clearer.

## Confirmation: the apply-patch port stays faithful

The 2026-08-25 P0-1 apply-patch proposal remains correct. `codex-apply-patch` depends on `similar` and `tree-sitter`, not `codex-git-utils`; the patch parser and applier are git-independent. `codex-git-utils` is an internal plumbing crate consumed by eleven crates (analytics, app-server, chatgpt, cloud-tasks, cloud-tasks-client, config, core, core-plugins, exec, memories/write, rollout, secrets) for baseline tracking and remote canonicalization. It is not a model-facing tool and does not change the apply-patch plan.

## Conclusion and next step

A 2026-08-31 verification corrected this note. Of the six proposed seams, four are confirmed standalone crates (`context-fragments`, `code-mode-runtime`, `workload-identity`, `prompts`); `agent-roles` is a module inside the `core` crate, not a portable crate; `guardian-context` was not located anywhere in `codex-rs/` and is withdrawn. The `history` crate stays in the research bucket. The codex `origin/main` ref is now at `51ebf5b184` with 141 `Cargo.toml` files under `codex-rs/`. The user push-sequence gate (unchanged since 2026-08-28) still blocks PR delivery; this note adds no push. The next proposal cycle should rank the four confirmed crates and the `agent-roles` module-level seam alongside the existing P0-P2 rows, and treat `guardian-review` as a dsh-side hypothesis with no codex source. Re-check the mirror only when a new `rust-v` tag lands or a patrol cycle re-reads the crate list.

## Alternatives considered

- Rewrite the 2026-08-25 inventory now: rejected because recording the new seams unblocks ranking without invalidating the evidence already reviewed.
- Defer all recording until each implementation is read fully: rejected because the crate-level facts are durable inputs and deeper reads can remain explicit ranking prerequisites.
- Keep `guardian-context` as a seam: rejected after the 2026-08-31 search returned zero path matches; an unverifiable seam would contaminate the ranking.

## Acceptance criteria

- Both language editions carry the same corrected candidate set (four confirmed crates, `agent-roles` as a `core` module, `guardian-context` withdrawn), caveats, overlap questions, and recheck trigger.
- The note distinguishes observed Codex facts (verified against `origin/main` `51ebf5b184`) from unranked dsh proposals and preserves the existing user push gate.
- The translation-pairing sidecar records matching blob hashes for both editions.

## Risks

The surviving seams are characterized from crate-level exports and module doc comments read against `origin/main`, not from a full implementation read; only `prompts` and `agent-roles` exports were read directly from source this round. The exact overlap depth between `agent-roles` (a `core` module) and dsh `preset/`, or between `context-fragments` and dsh `context/`, needs a deeper read before any proposal ranks them. The `code-mode-runtime` candidate requires a native V8 build (`rusty-v8-v150.4.0` tag), which conflicts with dsh's pure-TypeScript-ESM stance; it may need a new native addon or an out-of-process V8 host before it fits the architecture. The withdrawn `guardian-context` carries no port risk because there is no source to port; the `guardian-review` hypothesis, if pursued, is a greenfield dsh design that must add its own consent flow before becoming model-facing.