# @deepseek-ai/dsh-memories

[English](README.md) | 中文

一等记忆 seam，对位 `codex-rs/memories`。Seam 提供 `ctx.memories` 接口与一个文件系统 provider（`memories-filesystem`，落到 `~/.dsh/memories/<profile>/`）。现有的 `examples/mcp-memory` overlay（Memorix、reference-memory、Engram）降级为可选 provider，不再是唯一路径。

## 状态

仅占位。包形态已定，实现按本契约落地。

## 行为（实现后）

- 注册 `ctx.memories`，提供 `recall(scope, query)` 与 `record(scope, entry)` 两面。
- 默认文件系统 provider 在 `~/.dsh/memories/<profile>/<scope>/` 下完成一条记录的回环。
- 新增 `memory_recall` 工具面向模型，向下一轮透出 recall；不改会话日志格式。
- 持久化按 profile 与 scope 隔离，并通过 `interaction/approval` 显式记录同意；模型没有一次用户明确确认不得写持久记忆。
- `examples/mcp-memory` 下的 MCP overlay 保留，每个降级为可选 provider，不再是唯一路径。

## 存储立场

落地到当前 profile 的磁盘。Provider 拒绝写到 `~/.dsh/memories/<profile>/` 之外；切换 profile 必须经过一次用户明确确认。

## 信任立场

敏感条目会持久化。分层护栏：profile 隔离、scope 命名空间、每会话首次写入必经 `interaction/approval`、`dsh memory prune` 控制台命令遍历当前 profile。模型无法绕过同意。

## 导出形态

Seam 包：默认导出 `MemoriesService`（service key `memories`）；`./filesystem` 导出默认 provider。`memory_recall` 工具随 service 一同注册。

## 验收准则（取自提案笔记）

- 包实现完成后 `pnpm run build` 与 `pnpm run verify-package-invariants` 通过；`packages/core/`、`packages/session/`、`packages/runtime-diagnostics/`、`packages/observability/`、`packages/compaction/` 不动一行。
- `ctx.memories` 暴露 `recall` 与 `record`；文件系统 provider 在 `~/.dsh/memories/<profile>/` 下完成一条记录的回环；`memory_recall` 工具按 scope 返回当前会话可见记录。
- 同意通过 `interaction/approval` 记录；模型无法绕过。
- 配一个 `implemented/feature/<date>-…md` Agent Note 与对应 `.zh.md`；仅当引入新类目时才更新 `scripts/agent-note-tree.ts`。