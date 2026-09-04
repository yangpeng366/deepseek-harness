# @deepseek-ai/dsh-context-fragments

English | [中文](README.zh.md)

Typed request-context fragments shared across `packages/context/` contributors: a role-aware `Fragment<Body>` model, a marker pair the registry owns, a content-blind escape so untrusted body text cannot close the plugin-owned frame, and a recognition helper that re-identifies a prior injection from its persisted markers.

Step 1 ships the package, types, and the shared escape. `ctx.fragments.register` and `ctx.fragments.assemble` arrive in Step 2; the declaration-merge extension of `MessageSourceMap` is staged in Step 3; the agent-instructions binding that retires the duplicate escape lands in Step 4. Decision record: [dsh context-fragments seam Agent Note](../../../.agents/notes/proposed/feature/2026-09-03-dsh-context-fragments.md) and [four-step decomposition](../../../.agents/notes/proposed/feature/2026-09-04-dsh-context-fragments-implementation-steps.md).

## What this package owns today

- `Fragment<Body>` contribution model with `role`, `startMarker`, `endMarker`, `order`, and `body`.
- `escapeFrameBody(body, marker)` - the canonical escape every contributor and the future binding share.
- `RenderedFragment` and `FragmentMatch` value types.
- `escapeInstructionFrameBody(body)` - the agent-instructions helper kept byte-equivalent until Step 4 retires the duplicate.

## What this package does NOT own today

- Cordis plugin registration, lifecycle listeners, or `apply()`.
- A `MessageSourceMap` consumer. The merge stub at `packages/llm/llm/src/context-fragments.d.ts` is a marker comment only.
- Scope helpers, snapshot assembly, or durable emission.
