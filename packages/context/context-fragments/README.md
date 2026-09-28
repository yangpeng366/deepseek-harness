# `@deepseek-ai/dsh-context-fragments`

English | [中文](README.zh.md)

Typed request-context fragments: shared marker escape, role-aware body,
and a Cordis-backed registry that owns per-scope registration, layered
assembly, and content-blind recognition of previously injected spans.

The package is the registry side of the
[`dsh-context-fragments`](../../../../.agents/notes/proposed/feature/2026-09-03-dsh-context-fragments.md)
seam. Steps 1 and 2 of the four-step implementation plan land here; the
durable source kind, the binding companion, and the spine snapshot land
in Steps 3 and 4.

## Surface

```ts
import { apply, FragmentsService, escapeFrameBody } from '@deepseek-ai/dsh-context-fragments'

const ctx = new Context()
apply(ctx, { defaultRole: 'user' })

ctx.fragments.register({
  name: 'agent-instructions' as FragmentName,
  role: 'developer',
  startMarker: '<system-reminder>',
  endMarker: '</system-reminder>',
  order: 0,
  body: 'remember to be helpful',
})

const ordered = await ctx.fragments.assemble()
const rendered = ctx.fragments.render(ordered[0])
const matches = ctx.fragments.recognize(rendered.text)
```

The service owns the merged assembly across the active scope chain;
scoped fragments shadow globals with the same `name`, and the per-layer
duplicate-name and marker-collision checks throw at `register` time.
The invariant companion in `./invariant` catches cross-layer issues the
per-layer insertion check cannot see.

## Scope rules

Fragments follow the same scope rules as `system-prompt`: global
contributions and scope-keyed overlays, nearest scope shadowing, and the
exact Cordis effect disposer as the return value of `register`. A
disposed fragment leaves no residue in the layer; the assembly waterfall
sees the live set.

## Recognition

`recognize(text, scope?)` scans the text for the literal `startMarker` +
`endMarker` spans of every registered fragment in the active scope chain.
Each fragment contributes at most one match; overlapping candidates are
reported in registration order so the result is deterministic.

## Out of scope (Steps 3 and 4)

- A durable source kind on `MessageSourceMap` so the agent-loop can
  persist one `user/message` row per registered fragment.
- The binding companion that wires `ctx.fragments.register` into the
  shipped agent-instructions contributor without rewriting its render
  output byte-for-byte.
- A snapshot test that pins the assembled, rendered baseline.

## Configuration

`apply(ctx, config)` accepts an optional `defaultRole` (`'developer' |
'user'`, default `'user'`). The fallback role is exposed through
`ctx.fragments.resolveDefaultRole()` so contributors can opt in without
restating it on every fragment.