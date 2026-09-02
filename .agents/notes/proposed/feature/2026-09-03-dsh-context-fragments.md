# Agent Note: dsh context-fragments seam - annotated, role-aware request context

Status: proposed

English | [中文](2026-09-03-dsh-context-fragments.zh.md)

## Problem

`packages/context/` registers request-context plugins that contribute user-role `user/message` rows, but each contributor rolls its own framing and recognition. `agent-instructions` opens its baseline with a hardcoded `<system-reminder>` pair and escapes literal `</system-reminder>` substrings in instruction prose, paths, scope, and budget-marker text so repository-owned content cannot close the plugin-owned frame (`packages/context/agent-instructions/src/render.ts:10-11`). `time-context`, `tmux-context`, and the per-session snapshot helpers in `session-reference/` shape their own text without that escape. `system-prompt`'s `context()` registry concatenates dynamic contributions into one unordered runtime snapshot, with no marker, no role split, and no way for a later code path to recognize what it previously injected.

The Codex sibling, `codex-rs/core/src/context/fragment.rs`, defines a `ContextualUserFragment` trait whose `ROLE`, `START_MARKER`, `END_MARKER`, and `body()` describe the contribution precisely, plus a `FragmentRegistration` type-erased matcher so downstream code can recognize its own prior injections without rebuilding the payload. The model-visible difference: developer-role content and user-role content are typed separately, so a `HookAdditionalContext` can travel as developer-role material and an `AppsInstructions` fragment can travel with its own open/close pair while still being one ordered user-role row. The [refreshed mirror note](../process/2026-08-29-dsh-codex-parity-mirror-refresh.md) ranked `dsh-context-fragments` as the lowest-cost next cycle candidate precisely because the seam maps to a single new package with no native dependency.

Three separate problems force three separate fixes:

1. **Marker duplication.** The `<system-reminder>` open and close pair is an inline string constant. A second plugin that also wants a recognizable frame would either copy the same pair (so two contributors could be confused for one) or invent a different pair (so recognition rules diverge). A shared fragment seam owns the marker library and the canonical escape.
2. **Role ambiguity.** Every existing contributor emits a `user/message`, but downstream consumers (a permission hook that wants to read developer-only content; a compaction that wants to preserve developer-role text more aggressively than user-role text; a future client that wants to render developer context as an inline annotation instead of an out-of-band section) cannot tell developer content apart from user content. The current `MessageSourceMap` in `packages/llm/llm/src/message.ts:100-105` declares `user`, `plugin`, `model`, and `tool`; it has no role split.
3. **Recognition impossibility.** When `system-prompt.context()` evaluates a provider, the result is a string in `PromptAssembly.contexts[].text`. A later code path that wants to recognize what it previously injected must re-derive that string by re-evaluating the same provider, which can be impossible (time has moved, the cwd has changed, the credentials file was rotated). The Codex matcher solves this by recognizing the open/close pair in the persisted message body; dsh has no equivalent.

The plugin-candidates note added the seam as P1 next-cycle work and tied it to `packages/context/`. This note owns that seam.

## Proposal

Introduce `@deepseek-ai/dsh-context-fragments` as a new package under `packages/context/context-fragments/`. The package owns:

- A typed `Fragment<Body>` contribution model with `role`, `startMarker`, `endMarker`, `order`, and `body`, where `role` is `'developer' | 'user'`. A `render()` helper concatenates the markers and body without injecting whitespace, so a contributor that needs separators owns them in `body`.
- A `ctx.fragments.register(fragment)` API whose layer follows the same scope rules as `ctx.systemPrompt.context()`: global contributions and scope-keyed contributions, nearest scope shadowing. Duplicate names in one layer throw. The disposer is the exact Cordis effect disposer; the registry emits `fragments/change` for any observed change.
- A `ctx.fragments.assemble(scope?)` API that resolves every visible fragment in `order` ascending, returns one typed `RenderedFragment[]`, and applies the shared marker escape so untrusted `body` text cannot close the plugin-owned frame.
- A `ctx.fragments.recognize(text)` API that returns one `FragmentMatch` per registered fragment whose markers bracket the text, independent of body content. Recognition is content-blind: two fragments with the same markers never coexist in one layer; a fragment with empty markers never matches arbitrary text.
- A declaration-merge extension of `MessageSourceMap` (`packages/llm/llm/src/message.ts:100`) keyed `'context-fragments': { kind: 'context-fragments'; role: 'developer' | 'user'; fragment: string; order: number }`, so durable fragment rows carry their source kind, role, fragment name, and assembly order in the persisted log.

The shipped loop does not consume fragments directly. A separate `context-fragments/binding` companion, disabled by default and bound to the existing `agent-instructions`, demonstrates one wiring. When the binding is enabled, `agent-instructions` calls `ctx.fragments.assemble()` at its baseline step, folds each rendered fragment in `order` into the existing `<system-reminder>` body, and serializes the assembly as one `user/message` whose source kind is `agent-instructions` (preserving the existing typed changes) but whose `body` is the rendered fragment array. Existing tests that match the literal `<system-reminder>` frame and the `</system-reminder>` escape continue to pass. The binding is optional so the seam lands without disrupting `time-context`, `tmux-context`, or `session-reference`.

The shared escape is the same algorithm already used in `packages/context/agent-instructions/src/render.ts`. The package lifts it into `ctx.fragments.escape(text, marker)` so every future contributor reuses one implementation. The escape replaces each literal substring equal to `marker` with `<\` + `marker.slice(1)` (or `marker.replace(/^<\//, '<\\/')` for closing markers), preserving the existing tests.

A new invariant companion, `context-fragments-invariant`, runs after the assembled fragments settle and fails loud when:

- two visible fragments declare the same non-empty start marker;
- a fragment body, after escape, contains the fragment's own start or end marker;
- a fragment's role is neither `'developer'` nor `'user'`;
- an `order` is non-finite or duplicated within one layer.

The invariant companion follows the `system-prompt/invariant` precedent (`packages/core/system-prompt/src/invariant.ts`); it does not alter the registry or the rendered assembly, only fails loud.

## Fragment shape (typed contribution)

```ts
export type FragmentRole = 'developer' | 'user'

export interface Fragment<Body = unknown> {
  readonly name: string
  readonly role: FragmentRole
  readonly order: number
  readonly startMarker: string
  readonly endMarker: string
  readonly body: Body
}

export interface RenderedFragment {
  readonly name: string
  readonly role: FragmentRole
  readonly order: number
  readonly startMarker: string
  readonly endMarker: string
  readonly text: string
  /** Marker-escaped body, with start/end markers prepended and appended. */
  readonly rendered: string
}

export interface FragmentMatch {
  readonly name: string
  readonly role: FragmentRole
  readonly text: string
}
```

`body` is intentionally untyped at the registry; `render()` is a contribution-supplied function the registry calls inside `assemble()`. The shape above fixes the seam; the registry does not attempt to normalize `body`. A contributor that needs structured body extends `Fragment<Body>` via declaration merging on its own module so the registry stays merge-extensible.

## Recognition protocol

Recognition is a pure function over a string and the registered markers. The protocol is:

- A fragment whose `startMarker` or `endMarker` is the empty string never matches. The empty pair is the documented "unmarked fragment" escape; an unmarked fragment is recognized only by the durable source kind in the persisted log, never by text.
- A fragment whose start and end markers are both non-empty matches when the input's leading non-whitespace prefix equals `startMarker` (case-insensitive) and the trailing non-whitespace suffix equals `endMarker` (case-insensitive).
- Recognition returns one `FragmentMatch` per registered fragment, in `order` ascending, with the matched substring as `text`. Two fragments whose markers are identical never coexist in one layer; the invariant companion enforces this at registration time so `recognize()` is deterministic.
- `recognize()` does not re-evaluate providers and does not consult durable history. The marker pair is the only signal, so a recognition that runs after compaction still matches.

The match model is deliberately narrow: it recognizes a frame, not its meaning. A contributor that wants to "replace my last injection" calls `recognize()`, inspects the `RenderedFragment.name`, and re-registers the new body; the durable log retains the old frame until the contributor emits a new event. A contributor that wants to "append to my last injection" is rejected at design time: fragments are atomic, and an injection that grows must re-render.

## Message source map extension

The new source kind is added by declaration merging in `packages/context/context-fragments/src/message-source.d.ts`, imported once by `packages/llm/llm/src/message.ts`:

```ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'context-fragments': {
      kind: 'context-fragments'
      role: 'developer' | 'user'
      fragment: string
      order: number
      rendered: ReadonlyArray<{ name: string; role: FragmentRole; text: string }>
    } & ContextFormed
  }
}
```

The extension is merge-extensible so future packages can add their own role-specific kinds without colliding with this one. Existing `MessageSource = MessageSourceMap[keyof MessageSourceMap]` automatically picks up the new kind. The `ContextFormed` base keeps the persisted log symmetric with other plugin sources.

The extension lands in a separate `.d.ts` so consumers that do not depend on `@deepseek-ai/dsh-context-fragments` keep the existing closed map at the type level. Cordis events that need to declare a fragment-specific event (for example, `fragments/change`) declare it inside the same `.d.ts`, keeping the type-level surface inside the package that owns the seam.

## Cooperation with system-prompt and agent-instructions

`system-prompt/context()` and `ctx.fragments.register()` are intentionally distinct surfaces. The split:

- `system-prompt/context()` produces one ordered runtime-context snapshot whose text is joined by the registry and becomes part of the system prompt when `includeRuntimeContext` is true. It is the right surface for content that travels with the system prompt and that the model treats as deployment-level guidance.
- `ctx.fragments.register()` produces one typed, marker-framed, role-typed row that enters the durable user/developer role history. It is the right surface for content that the model must distinguish from the system prompt (a hook-injected developer note, a permission reminder, an apps-instructions block) and that other code must be able to recognize later.

The two surfaces do not share an order space. A contributor that chooses fragments owns its order in the fragment layer; a contributor that chooses system-prompt runtime context owns its order in the `PromptContext` layer. The agent loop renders fragments as part of the durable message stream before the system prompt is assembled, so a fragment's developer-role row is visible to the model independently of the system prompt's runtime context. This matches the Codex split where a developer fragment travels as a separate `ResponseItem` whose role is the fragment's `ROLE`.

`agent-instructions` keeps its own source kind (`'agent-instructions'`) so the persisted typed changes (`AgentInstructionChange[]`) remain the durable record. When the optional binding is enabled, `agent-instructions` calls `ctx.fragments.assemble()` and folds the rendered text into its existing `<system-reminder>` body, keeping the literal marker pair that existing tests pin. A new test in `packages/context/context-fragments/tests/binding.spec.ts` proves that, with the binding disabled, no rendered fragment text appears in the agent-instructions baseline.

## Migration set

| Contributor | Before | After | Notes |
|---|---|---|---|
| `agent-instructions` baseline | Inline `<system-reminder>` open/close and escape (`packages/context/agent-instructions/src/render.ts:10-11`) | `ctx.fragments.register({ name: 'agent-instructions', role: 'user', order: 0, startMarker: '<system-reminder>', endMarker: '</system-reminder>', body })` with the binding companion enabled by default in the spine bundle | The escape moves into `ctx.fragments.escape`. The literal frame remains so existing tests continue to pass. The body becomes the assembled fragment text plus the existing intro and per-file sections. |
| `time-context` runtime snapshot | `ctx.systemPrompt.context()` returning the current-time line | `ctx.fragments.register({ name: 'time-context', role: 'user', order: 50, startMarker: '<time-context>', endMarker: '</time-context>', body })` with `body` returning the current-time line | The runtime-context contributor is removed from `system-prompt/`. The frame is recognized later by the `<time-context>` markers, not by the durable source kind alone. |
| `tmux-context` runtime snapshot | `ctx.systemPrompt.context()` returning the tmux pane line | `ctx.fragments.register({ name: 'tmux-context', role: 'user', order: 50, startMarker: '<tmux-context>', endMarker: '</tmux-context>', body })` | Same shape as `time-context`; one marker pair per package. |
| Hook additional context (future) | N/A in dsh today | `ctx.fragments.register({ name: 'hook-additional-context', role: 'developer', order: 0, startMarker: '', endMarker: '', body })` | Unmarked developer-role fragment; recognition travels in the persisted source kind, not by text. This is the codex-rs `HookAdditionalContext` precedent. |
| Apps instructions (future) | N/A in dsh today | `ctx.fragments.register({ name: 'apps-instructions', role: 'user', order: 100, startMarker: '<apps-instructions>', endMarker: '</apps-instructions>', body })` | The body carries the static "Apps (Connectors) can be explicitly triggered..." block. Mirrors `codex-rs/core/src/context/apps_instructions.rs`. |

Each row of the table is one vertical commit: registry surface, package-local README update, declaration-merge sidecar, binding companion if listed, tests. A new contributor that wants to register a fragment imports `@deepseek-ai/dsh-context-fragments` and calls `ctx.fragments.register(...)`; the seam is intentionally small enough that adding a contributor is one call plus one merge-extend type.

## Deferred contributors

| Contributor | Reason deferred | Resuming trigger |
|---|---|---|
| `session-reference` snapshot helper | The bounded snapshot deliberately serializes a structured payload (session id, scope, projection envelope); a marker-framed string would lose the structured form. The contributor keeps emitting `user/message` rows with the existing typed source kind. | A future revision that exposes snapshot text as a fragment must preserve the structured projection; until then, snapshot helpers stay on `MessageSourceMap['session-reference']`. |
| Skill catalog rendering | Skill guidance travels as a `systemPrompt.context()` contribution because its text is rendered against the live skill catalog and is intentionally part of the system prompt when `includeRuntimeContext` is true. The catalog is not a developer/user split. | If a future skill seam wants per-skill annotation rather than one runtime snapshot, it migrates to fragments with `role: 'developer'`. |
| Workspace persona | Owned by `system-prompt.section()` because it travels as one fixed slot in the system prompt. The owner has decided it stays. | A persona override that wants runtime recognition migrates to a fragment with `role: 'user'` and an explicit `startMarker`; the system prompt path remains authoritative for the persona itself. |
| Tool runtime context | Owned by `systemPrompt.context()` because it joins the runtime snapshot. | If a future tool wants developer-role annotation (for example, an in-flight permission reminder), it migrates to a fragment; the runtime-context path remains authoritative for the static tool guidance. |
| Agent-loop `model` and `cwd` variables | Owned by `systemPrompt.variable()` because they are `{{variable}}` interpolations inside sections, not standalone rows. | Variables are not fragments; they remain `systemPrompt.variable()` unless a future change reworks the variable registry. |

## Alternatives considered

**Reuse `ctx.systemPrompt.context()` for everything.** Rejected because the system prompt runtime snapshot has no marker, no role split, and no recognition protocol; the three problems above are exactly the things a fragment seam owns. Adding marker and role to `systemPrompt.context()` would conflate system-prompt runtime context with role-aware user/developer content.

**Reuse `agent-instructions` as the universal workspace-context plugin.** Rejected because `agent-instructions` is purpose-specific to file-based workspace instructions, with a dedicated `'agent-instructions'` source kind carrying typed `AgentInstructionChange[]` rows for resume reconciliation. A seam that wants to type role-aware user/developer content independently of file-based instructions needs its own registry and its own source kind.

**Implement recognition per-package without a shared registry.** Rejected because each contributor would re-derive its own marker pair and its own escape, and two contributors that picked the same open/close string would be unrecognizable from each other. The shared registry owns the marker namespace and the escape so recognition stays deterministic.

**Add the seam inside `system-prompt/` instead of `context/`.** Rejected because the seam's contract is "contribute a role-typed, marker-framed row to the durable log", not "contribute a section, context, or variable to the system prompt assembly". A package that lives next to `agent-instructions`, `session-reference`, and `time-context` keeps the registration semantics aligned with its peers; a package that lives inside `system-prompt/` would force every contributor to depend on `system-prompt/` even when it does not contribute to the prompt.

**Reimplement markers as XML-like tags in user prose.** Rejected because the existing escape in `agent-instructions` proves the inverse: literal `</system-reminder>` in repository content is the documented attack surface, and the shared escape is the only documented mitigation. A new escape per contributor is a regression, not a feature.

**Skip role typing and keep everything as `user`.** Rejected because the Codex split exists for a reason: developer-role content (hook additional context, future permission reminders) travels with stricter authority than user-role content (workspace instructions, time stamps). Compaction, recognition, and client rendering all branch on role; collapsing the role split would force those branches onto ad-hoc name checks.

## Acceptance criteria

- `ctx.fragments.register(...)` accepts a typed fragment, returns the exact Cordis effect disposer, and rejects duplicate names in one layer with a thrown error.
- `ctx.fragments.assemble(scope?)` returns `RenderedFragment[]` ordered ascending, escapes the body against the fragment's own markers, and applies scope shadowing consistent with `ctx.systemPrompt.context()`.
- `ctx.fragments.recognize(text)` returns one `FragmentMatch` per registered fragment whose non-empty markers bracket the text, in `order` ascending, and returns `[]` for an unmarked fragment or an unmarked input.
- The `MessageSourceMap` extension compiles under `strict: true` with `noImplicitAny` and is merge-extensible so future packages can add their own role-specific kinds without modifying this note.
- A package test covers marker round-trip: a fragment whose body contains its own start or end marker fails the invariant companion with a message that names the marker and the fragment.
- A package test covers recognition: `recognize('<system-reminder>body</system-reminder>')` returns one match named `'agent-instructions'` (when registered); recognition after a compaction that shadows the original event still returns the same match.
- A binding test proves that with the `agent-instructions` binding enabled, the literal `<system-reminder>` frame and the `</system-reminder>` escape continue to appear in the rendered baseline and that the durable source kind remains `'agent-instructions'`.
- A binding test proves that with the binding disabled, no rendered fragment text appears in the agent-instructions baseline and the package boots with no observable regression.
- The invariant companion is registered via `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)` and runs after the registry settles; a duplicate marker or a body that escapes its own frame fails loud at the next pre-step.
- The shared `ctx.fragments.escape(text, marker)` algorithm matches the existing escape in `packages/context/agent-instructions/src/render.ts` exactly, so the lifted implementation does not regress the existing agent-instructions tests.
- The new package passes `pnpm run typecheck`, `pnpm run lint`, `pnpm run hygiene`, `pnpm run test`, and `pnpm run test:coverage` for its own source files, and the workspace `pnpm run test` continues to pass.

## Risks

**Marker collisions across contributors.** Two packages that register fragments with the same non-empty start or end marker would be unrecognizable from each other. The invariant companion enforces uniqueness at registration time, but a misconfigured contributor could still register a marker that shadows a system-level escape; the recognition protocol's case-insensitive match widens the namespace and makes accidental collisions more likely. Mitigation: the registry logs a `warn`-level event when a contributor's marker contains characters reserved for future escape syntax, and the invariant companion fails loud for any duplicate in one layer.

**Compaction shadows a fragment row.** The Codex model relies on persisted markers to recognize a prior injection after compaction. dsh compaction currently preserves source kind but may rewrite body content; if a rewrite drops a fragment's markers, `recognize()` stops working. Mitigation: the binding companion stores the rendered text in the durable source's `rendered` field, and the invariant companion fails loud when a compacted row's body no longer contains its registered markers.

**Two surfaces that look similar.** A contributor that already calls `ctx.systemPrompt.context()` may inadvertently call `ctx.fragments.register()` instead, or vice versa. Mitigation: the README for each surface explicitly contrasts the two, the package test imports only one of the two per file, and `pnpm run duplication` (cross-file clone detection) flags any contributor that registers both surfaces for the same name.

**Persistence cost.** Each rendered fragment becomes one durable `user/message` row with a typed source kind, a role, a name, an order, and an embedded `rendered` array. A session that registers many fragments per step will accumulate rows faster than the current system-prompt runtime snapshot. Mitigation: the shipped loop's `agent-loop` budget already trims context, and `system-prompt/includeRuntimeContext` does not affect fragments; the binding companion's `maxBytes` reuse applies the same trim to the assembled body so the cost matches the existing agent-instructions budget.

**The shared escape regresses on edge cases.** The escape in `packages/context/agent-instructions/src/render.ts` was tested with repository paths and budget markers; a wider corpus of body content (multi-line code, mixed-case closing tags, partial matches at line boundaries) may expose new escape bugs once the helper is shared. Mitigation: the package test ships a corpus that mirrors the existing agent-instructions escape tests and adds a multi-line code block, a mixed-case closing tag, and a partial match at a line boundary, all of which must round-trip without regressing.

**Scope shadowing diverges from `system-prompt`.** `ctx.fragments.assemble(scope?)` follows the scope rules of `ctx.systemPrompt.context()`; if a future change to system-prompt's scope rules (for example, a new ancestor-only shadowing policy) is not mirrored here, the two surfaces drift. Mitigation: the registry's scope helper is the exact `ScopedLayers` from `@deepseek-ai/dsh-scope` shared by `system-prompt/`; a regression test asserts that `assemble(undefined)` and `assemble(scopeKey)` produce the same shadowing behavior as `systemPrompt.assemble` for the same registrations.

This note applies the existing `system-prompt/`, `agent-instructions`, and `MessageSourceMap` seams rather than superseding any of them. The `system-prompt` registry remains authoritative for sections, contexts, tools, and variables. The `agent-instructions` source kind remains authoritative for workspace instructions and resume reconciliation. The `MessageSourceMap` extension lands in a separate `.d.ts` and is merge-extensible; no existing source kind changes its shape. The plugin-candidates note, the refreshed mirror note, and the [plugin-roles proposal](2026-08-26-dsh-collaboration-presets.md) continue to own their surfaces and require factual ranking updates, not archival.
