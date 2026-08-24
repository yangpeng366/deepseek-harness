# @deepseek-ai/dsh-bundle-otel-exporter

[English](README.md) | 中文

可选 bundle：将会话诊断与运行时计数导出至 OTLP collector（gRPC 或 HTTP），作为 `ctx.diagnostics` 的一个 sink 注册。对位 `codex-rs/otel`，但不把 OTel SDK 拖入核心依赖图。

## 状态

仅占位。包形态已定，实现按本契约落地。

## 行为（实现后）

- 启动时向 `ctx.diagnostics` 注册一个 sink，停止时移除。
- 未设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时为 no-op。
- 设置后，每个 `runtime-diagnostics` 事件在 5 s 内到达 collector，并附带每轮一次的会话汇总计数。
- 默认端点 `127.0.0.1:4317`；端点为 `0.0.0.0` 或公网域名且 cordis.yml 未显式开启 `--allow-external` 时拒绝启动。
- OTel JS SDK 以 peerDependency 形式引入，避免进入核心依赖图。

## 存储立场

进程本地。本包不写磁盘。会话日志仍是单一事实来源，本 bundle 只是侧车导出，不是替代。

## 信任立场

sink 按设计可见会话事件。上文端点拒绝规则是对意外公网暴露的唯一硬护栏；需要远端 collector 的部署必须显式 opt-in 并审计目的地址。

## 导出形态

Bundle 包：默认导出 `OtelExporterBundle`。不向模型暴露工具。本 bundle 仅通过 `cordis.yml` overlay 注册，永不自动加载。

## 验收准则（取自提案笔记）

- 包实现完成后 `pnpm run build` 与 `pnpm run verify-package-invariants` 通过；`packages/core/`、`packages/session/`、`packages/runtime-diagnostics/`、`packages/observability/` 不动一行。
- 未设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时为 no-op。
- 设置后每个 `runtime-diagnostics` 事件与每轮会话汇总计数在 5 s 内到达 collector。
- 配一个 `implemented/feature/<date>-…md` Agent Note 与对应 `.zh.md`；仅当引入新类目时才更新 `scripts/agent-note-tree.ts`。