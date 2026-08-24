# @deepseek-ai/dsh-bundle-otel-exporter

English | [中文](README.zh.md)

Optional bundle that ships session diagnostics and runtime counters to an OTLP collector (gRPC or HTTP) registered against `ctx.diagnostics`. Mirrors the role of `codex-rs/otel` without bringing the OTel SDK into the core dependency graph.

## Status

Scaffold only. The package shape is fixed; the implementation lands behind this contract.

## What it does (when implemented)

- Registers one sink against `ctx.diagnostics` at start, removes it at stop.
- When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, the bundle is a no-op.
- When the endpoint is set, every `runtime-diagnostics` event reaches the collector within 5 s, plus one session summary counter per turn.
- Default endpoint `127.0.0.1:4317`; refuses to start when the endpoint is `0.0.0.0` or a public hostname without an explicit `--allow-external` flag in the cordis.yml overlay.
- Imports the OTel JS SDK as a peerDependency so the SDK stays out of the core dependency graph.

## Storage stance

Process-local. Nothing here is written to disk. The session log remains the source of truth; this bundle is a sidecar export, not a replacement.

## Trust stance

The sink sees session events by design. The endpoint refusal above is the only hard guard against accidental public exposure; deployments that need remote collectors must opt in explicitly and audit the destination.

## Export shape

Bundle package: default-exports `OtelExporterBundle`. No model-facing tool. The bundle is registered through `cordis.yml` overlays, never auto-loaded.

## Acceptance criteria (mirrored from the proposal note)

- `pnpm run build` and `pnpm run verify-package-invariants` pass after the package is implemented, with no edits under `packages/core/`, `packages/session/`, `packages/runtime-diagnostics/`, or `packages/observability/`.
- With no `OTEL_EXPORTER_OTLP_ENDPOINT` set the bundle is a no-op.
- With the endpoint set, every `runtime-diagnostics` event and one session summary counter arrive at the collector within 5 s.
- One `implemented/feature/<date>-…md` Agent Note pairs a `.zh.md` counterpart and updates `scripts/agent-note-tree.ts` only if a new class is needed.