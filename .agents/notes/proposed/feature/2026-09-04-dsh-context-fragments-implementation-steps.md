# Agent Note: dsh context-fragments implementation steps - four-step decomposition

Status: proposed

English | [中文](2026-09-04-dsh-context-fragments-implementation-steps.zh.md)

## Problem

The [dsh-context-fragments seam](2026-09-03-dsh-context-fragments.md) is sound against the current source: every cited line reference (`packages/context/agent-instructions/src/render.ts:10-11`, `:81`, `packages/llm/llm/src/message.ts:100-105`, `packages/core/system-prompt/src/invariant.ts`) was re-verified against the working tree on 2026-09-03 before this note was written. `packages/context/context-fragments/` does not yet exist as a directory; the six sibling packages (`agent-instructions`, `file-reference`, `file-reference-local`, `session-reference`, `time-context`, `tmux-context`) are listed under `packages/context/` and none owns a typed `Fragment<Body>` model, a shared marker escape, or a developer/user role split in `MessageSourceMap`.

The seam as specified is too large for one pull request. It touches a new package (`@deepseek-ai/dsh-context-fragments`), a declaration-merge extension of `packages/llm/llm/src/message.ts`, an opt-in binding that rewrites `packages/context/agent-instructions/`'s render path, an invariant companion registered through `ctx.invariants`, and a workspace re-glue that adds one package and one exported `apply()`. Reviewers cannot verify a 600-line diff without breaking it into focused commits. A monolithic PR also obscures the risk profile: a regression in the shared escape must not block a discussion of role-split typing, and a binding refactor must not block a discussion of the registry API.

This note decomposes the seam into four reviewable steps. Each step ends in a green test run, lists the files it touches, and declares what it does NOT change so the reviewer can stop reading early. The note does not redefine the seam; it only orders it for execution and verifies each step against the parent proposal's acceptance criteria.

## Proposal

Four steps, each shipped as one PR or one commit series against `master`. The order is binding: a later step depends on the registry, the declaration-merge extension, or the binding from an earlier step, but never the reverse.

### Step 1 - Scaffold the package, types, and shared escape

Create the new package `packages/context/context-fragments/` with the same boilerplate as `packages/context/time-context/` (peer/dev dependency wiring, tsconfig that references the same vendors and core packages, README triplet, `tsdown.config.ts`). Land the core types and the shared escape as pure-function exports; do NOT register any Cordis service, do NOT import from `@deepseek-ai/cordis`, and do NOT touch `packages/llm/llm/src/message.ts`. The acceptance criterion is the shared escape matches `escapeInstructionFrameBody` from `packages/context/agent-instructions/src/render.ts:81` byte-for-byte, verified by a port of the existing agent-instructions escape tests into `tests/escape.spec.ts`.

Files added:

- `packages/context/context-fragments/package.json`
- `packages/context/context-fragments/tsconfig.json`
- `packages/context/context-fragments/tsdown.config.ts`
- `packages/context/context-fragments/README.md`
- `packages/context/context-fragments/README.zh.md`
- `packages/context/context-fragments/README.i18n.yaml`
- `packages/context/context-fragments/src/escape.ts`
- `packages/context/context-fragments/src/index.ts`
- `packages/context/context-fragments/tests/escape.spec.ts`
- `packages/context/context-fragments/tests/types.spec.ts`
- `packages/llm/llm/src/context-fragments.d.ts` (declaration-merge stub; merged into `MessageSourceMap` with a marker comment only, not consumed yet)

Files unchanged in this step:

- `packages/llm/llm/src/message.ts` (no import yet)
- `packages/context/agent-instructions/src/render.ts` (escape is duplicated by the new package, not lifted)
- `packages/core/system-prompt/` (no registration)

Verification commands:

```
pnpm --filter @deepseek-ai/dsh-context-fragments run typecheck
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm run typecheck
```

The third command proves the declaration-merge stub typechecks without importing it. Step 1 ends the parent proposal's "shared escape matches existing escape" criterion but does not yet retire the duplicate in `agent-instructions`.

### Step 2 - Register the fragments service and wire the invariant companion

Add `ctx.fragments.register`, `assemble`, `recognize`, and the `fragments/change` event through `ctx.effect()` in `src/registry.ts`. Register the invariant companion through `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)` mirroring `packages/core/system-prompt/src/invariant.ts`. Wire the export `apply()` in `src/index.ts` so the spine bundle can opt in. Lift the duplicate escape from `packages/context/agent-instructions/src/render.ts:81` into `packages/context/context-fragments/src/escape.ts` and have `agent-instructions` import the lifted helper (one-line change at the existing call site). No binding or role-split work yet; this step lands the registry surface only.

Files changed:

- `packages/context/context-fragments/src/registry.ts` (new)
- `packages/context/context-fragments/src/invariant.ts` (new)
- `packages/context/context-fragments/src/index.ts` (re-export `apply`)
- `packages/context/agent-instructions/src/render.ts` (replace inline `escapeInstructionFrameBody` with import; one line)
- `packages/context/agent-instructions/tests/escape.spec.ts` (assert the lifted helper matches the previous byte output)
- `packages/context/context-fragments/tests/registry.spec.ts` (new)
- `packages/context/context-fragments/tests/invariant.spec.ts` (new)
- `packages/context/context-fragments/tests/scope-shadowing.spec.ts` (new; compares against `systemPrompt.assemble` for the same registrations)

Files unchanged in this step:

- `packages/llm/llm/src/message.ts` (no role-split extension yet)
- `packages/context/agent-instructions/src/binding.ts` (no binding companion yet)

Verification commands:

```
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm --filter @deepseek-ai/dsh-agent-instructions run test
pnpm --filter @deepseek-ai/dsh-system-prompt run test
pnpm run typecheck
pnpm run lint
```

Step 2 ends the parent proposal's "duplicate name in one layer throws", "scope shadowing follows `ctx.systemPrompt.context()`", "invariant companion fails loud on duplicate markers", and "shared escape matches existing escape exactly" criteria.

### Step 3 - Extend `MessageSourceMap` and emit durable fragment rows

Replace the `packages/llm/llm/src/context-fragments.d.ts` stub from Step 1 with the actual declaration-merge payload: `'context-fragments': { kind: 'context-fragments'; role: 'developer' | 'user'; fragment: string; order: number; rendered: readonly string[] }`. Have `ctx.fragments.assemble(scope?)` emit one durable `user/message` row per visible fragment through `createUserMessage` with this source kind, registered via a new `agent/post-step` listener (or the equivalent hook the spine uses; this is the only step that depends on `agent-loop` internals). No binding companion yet; this step proves the registry's emission path.

Files changed:

- `packages/llm/llm/src/context-fragments.d.ts` (final payload)
- `packages/llm/llm/src/message.ts` (single `import` line for the merge; no body change)
- `packages/context/context-fragments/src/registry.ts` (add `agent/post-step` listener)
- `packages/context/context-fragments/tests/durable-row.spec.ts` (new; replay asserts the row's source kind, role, name, and order)
- `packages/context/context-fragments/tests/recognize-after-compaction.spec.ts` (new; mirrors the parent proposal's compaction-shadowing mitigation)

Files unchanged in this step:

- `packages/context/agent-instructions/src/binding.ts` (no binding companion)
- `packages/core/agent-loop/` (no loop change; listener attaches to the existing post-step hook)

Verification commands:

```
pnpm --filter @deepseek-ai/dsh-llm run typecheck
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm run test:snapshot -t context-fragments
```

Step 3 ends the parent proposal's "merge-extensible `MessageSourceMap`", "recognition returns one `FragmentMatch` per registered fragment", and "compaction that shadows the original event still returns the same match" criteria.

### Step 4 - Land the `agent-instructions` binding companion

Add an opt-in binding companion at `packages/context/agent-instructions/src/binding.ts` that registers `agent-instructions` as one fragment through `ctx.fragments.register` instead of writing the literal `<system-reminder>` frame directly. The companion is enabled by default in the spine bundle (`packages/bundle/agent-spine/cordis.yml`) and disabled in the legacy bundle (`packages/bundle/agent-spine-legacy/cordis.yml`). With the binding enabled, the literal `<system-reminder>` frame and the `</system-reminder>` escape continue to appear in the rendered baseline (the parent proposal's binding-enabled acceptance criterion); with the binding disabled, no rendered fragment text appears and the package boots with no observable regression (the parent proposal's binding-disabled acceptance criterion).

Files changed:

- `packages/context/agent-instructions/src/binding.ts` (new)
- `packages/context/agent-instructions/src/index.ts` (re-export binding)
- `packages/context/agent-instructions/tests/binding-enabled.spec.ts` (new)
- `packages/context/agent-instructions/tests/binding-disabled.spec.ts` (new)
- `packages/bundle/agent-spine/cordis.yml` (enable binding in the spine bundle)
- `packages/bundle/agent-spine-legacy/cordis.yml` (disable binding in the legacy bundle)
- `packages/examples/agent-spine/cordis.yml` (verify in the example)

Files unchanged in this step:

- `packages/context/context-fragments/` (no API change)
- `packages/llm/llm/src/message.ts` (no shape change)

Verification commands:

```
pnpm --filter @deepseek-ai/dsh-agent-instructions run test
pnpm --filter @deepseek-ai/dsh-bundle-agent-spine run test
pnpm --filter @deepseek-ai/dsh-bundle-agent-spine-legacy run test
pnpm run test
pnpm run test:coverage
pnpm run hygiene
pnpm run doc-sync
```

Step 4 ends every remaining acceptance criterion in the parent proposal: the literal frame persists, the durable source kind remains `'agent-instructions'`, the registry emits rows through the binding's `assemble()` call, and the spine bundle's snapshot tests replay unchanged because the rendered output is byte-equivalent.

## Alternatives considered

### Why not ship the seam in one PR?

A single 600-line diff against `master` would mix five review surfaces (new package, registry, declaration-merge extension, binding, snapshot tests) and force the reviewer to read everything before accepting anything. A regression in the shared escape would block the discussion of role-split typing; a binding refactor would block the discussion of the registry API. The parent proposal estimates the seam at "lowest-cost next-cycle candidate" because it is small relative to a fresh Agent Loop rewrite, not because it is small in absolute terms. A one-PR landing would still cost roughly the same review time as the four-step plan and would surface a worse failure mode if Step 4's binding introduced a snapshot regression.

### Why not land a feature flag in one PR?

A single PR with the binding behind a feature flag would still register the registry, merge into `MessageSourceMap`, and lift the escape in the same change. Reviewers would read a half-built surface: the registry without a consumer, the merge without a row shape, the escape without a binding. Each step's review value is the gap between what landed and what is still pending; collapsing the gap into one PR collapses the review value. A four-step plan keeps each reviewer focused on one shipped slice.

### Why not the reverse order?

A reverse order would have to ship the binding in Step 1 (so the existing escape can be lifted into a registry the binding calls) and the registry in Step 2 (so the merge in Step 3 has somewhere to register its row shape). Step 1 would carry the most surface and the least signal: a binding companion can only be reviewed against the registry it talks to, but a registry that depends on a binding cannot be reviewed in isolation. The chosen order lets each step's CI run isolate its own failure.

### Why not split the parent proposal into separate notes per step?

The parent proposal owns the design; this note owns the ordering. Splitting the design across four notes would force every reviewer to reconstruct the contract by reading four headers, and would risk drift between the step notes and the parent. The four-step decomposition cites the parent proposal's acceptance criteria verbatim so a reviewer can map each step to a contract line.

## Acceptance criteria

**Step 1** is done when the new package's `tests/escape.spec.ts` passes all 17 assertions, the `escapeFrameBody('body', `</system-reminder>`)` output is byte-for-byte equal to the original `escapeInstructionFrameBody('body')` for every fixture in the ported test suite, no file in `packages/context/context-fragments/src/` imports from `@deepseek-ai/cordis` or `@deepseek-ai/dsh-agent`, `packages/llm/llm/src/context-fragments.d.ts` is a declaration-merge stub that no file imports today, and `pnpm run typecheck` succeeds workspace-wide.

**Step 2** is done when `ctx.fragments.register`, `assemble`, `recognize`, and the `fragments/change` event are reachable through the new package's `apply()`, the invariant companion is registered through `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)`, the duplicate `escapeInstructionFrameBody` is lifted out of `packages/context/agent-instructions/src/render.ts` and the agent-instructions test suite still passes without modification, and `pnpm --filter @deepseek-ai/dsh-context-fragments run test` is green.

**Step 3** is done when `MessageSourceMap['context-fragments']` is consumed by an `agent-loop` listener that emits one durable row per registered fragment through the existing `SessionEventMap` mechanism, the rendered `text` field equals `startMarker + escapeFrameBody(body, endMarker) + endMarker` for every registered fragment, every existing spine-bundle snapshot test still replays byte-equivalent content, and `pnpm run test:coverage` reports 100% per-file on the new package.

**Step 4** is done when `packages/bundle/agent-spine/cordis.yml` enables the new binding companion, `packages/bundle/agent-spine-legacy/cordis.yml` keeps the binding disabled and still replays its baseline snapshot, `pnpm run test:snapshot` passes for the new `agent-instructions-binding-enabled` filter, `pnpm run hygiene` and `pnpm run doc-sync` are clean, and the parent proposal's `## Acceptance criteria` is now satisfied end-to-end so this note can be consolidated into the parent proposal under the [implemented/AGENTS.md](../../implemented/AGENTS.md) rule.

## Ordering rationale

The four steps are sequenced so each one ends with the smallest possible blast radius and the largest possible signal. Step 1 ships pure-function code with no Cordis or LLM touch; if the shared escape regresses, only the new package's tests fail. Step 2 introduces the registry and the invariant companion behind `apply()`, so the registry surface is reviewable without reading the durable-row emission path. Step 3 introduces the durable row shape and the agent-loop listener, which are the only changes visible to downstream consumers. Step 4 introduces the binding companion, which is the only step that visibly changes a shipped plugin's render output (and even then, only to byte-equivalent content).

The reverse order would couple concerns reviewers need to read in isolation. A binding PR that also lifts the escape cannot tell a reviewer whether a regression came from the lift, the binding, or the registry. A registry PR that also ships the declaration-merge extension cannot tell a reviewer whether a typing failure came from the merge or the registry. The chosen order lets each step's CI run isolate its own failure.

## Risks

**The duplicate escape in Step 1 diverges before Step 2 lifts it.** Two copies of `escapeInstructionFrameBody` exist between Step 1's commit and Step 2's lift; if `packages/context/agent-instructions/src/render.ts` changes its escape semantics in that window, the lifted helper will not match. Mitigation: Step 1's PR includes a CI note that `packages/context/agent-instructions/src/render.ts:81` must remain unchanged until Step 2 lands, and Step 2's PR re-records the byte-equivalence test before deleting the duplicate.

**Step 3's `agent/post-step` hook may not exist.** The parent proposal assumes the spine uses an `agent/post-step` listener for durable emissions; if the actual hook is `agent/post-step-message` or `session/event`, Step 3 must adjust without changing Steps 1-2. Mitigation: Step 3's PR includes a 5-line spike that registers the listener against the actual hook name in a temporary test, fails loud if no hook matches, and uses the discovered name throughout the rest of the step.

**Step 4's spine snapshot tests regress.** The binding companion promises byte-equivalent rendered output; if the binding's `assemble()` call returns a fragment whose `body` differs from the legacy literal frame (for example, by trimming the trailing newline or reordering the closing marker), every spine snapshot fails. Mitigation: Step 4 lands a binding-only snapshot first (`test:snapshot -t agent-instructions-binding-enabled`), runs the legacy baseline against it, and only then enables the binding in the spine bundle.

**The four steps land against `master` faster than the upstream maintainer can review.** The parent proposal's note predates the implementation, and four focused PRs in quick succession may exceed the upstream review bandwidth. Mitigation: hold Step 4 until Steps 1-3 are merged or explicitly accepted, and signal the four-step plan in the parent proposal's PR description so the reviewer sees the trajectory before reading the first commit.

This note is a workflow decomposition of the parent proposal. It does not redefine the seam, the type surface, the registry API, or the binding companion. The parent proposal remains the authority for the design; this note only orders the implementation so each step's reviewer can read its diff in isolation. When Step 4 ships and every acceptance criterion in the parent proposal passes, this note is consolidated into the parent proposal under the [implemented/AGENTS.md](../../implemented/AGENTS.md) rule.