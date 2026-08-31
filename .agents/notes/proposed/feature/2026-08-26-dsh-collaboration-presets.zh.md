# Agent Note: dsh 协作预设 —— 对位 codex collaboration-mode

Status: proposed

[English](2026-08-26-dsh-collaboration-presets.md) | 中文

## 问题

主 RFC [2026-08-25-dsh-plugin-candidates](2026-08-25-dsh-plugin-candidates.zh.md) 按 capability-seam 维度盘点 dsh 与 codex 的差距（新包：P0-1 `tool-apply-patch`、P0-2 `bundle-otel-exporter`、P0-3 `memories`）。另一面 codex 表面 —— `codex-rs/collaboration_mode` 及其 CLI 预设（`default`、`plan`、`execute`、`pair_programming`）—— 当时未列入清单，因为 `packages/preset/` 已可接纳任意 `preset.yml`。该差距不是缺一个包，而是缺一份**可在会话起点从 CLI 直接挑选的命名 bundle**。

## 发现

新 worktree `dsh-collaboration-presets-2026-08`，位于 `F:\github\dsh-experiments\dsh-collaboration-presets-2026-08`，HEAD `bfa855ca1f`，在 `apps/cli/config/agent-presets/` 下落地四个与 codex 命名模式一一对应的协作预设：

- `co-default/` —— 只读默认。仅暴露 `tool-fs`（readOnly）/ `tool-fs-search` / `tool-skill`。行为契约：先读后答，永不修改工作树。
- `co-plan/` —— 计划模式。同 `co-default` 的只读工具面，外加计划书写输出。行为契约：先产书面计划，待用户显式确认才允许落到任何会改变状态的工具。
- `co-execute/` —— 执行模式。暴露 `tool-bash`（Linux/macOS）/ `tool-pwsh`（Windows）/ `tool-fs` / `tool-fs-search` / `tool-apply-patch` / `tool-jobs` / `tool-skill`。显式禁用 `subagent`，保持执行链路线性。行为契约：执行已批准计划；遇阻塞工具立即返回 `blocked` 并附一行 ask。
- `co-pair/` —— 结对编程模式。工具与 `co-execute` 一致但不含 `tool-jobs`。显式禁用 `web_search` / `subagent`。行为契约：每一步附一行 rationale；下一步不明即停下确认。

每条预设交付三件套：`agent.cordis.yml`（组合）、`preset.yml`（名称 / 描述 / 排序）、`README.md`（工具白名单 + 行为契约）。`bfa855ca1f` 上合计 12 个文件 / +228 行。

## 为何这是 codex 对位差距

`codex-rs/collaboration_mode.rs` 把四个命名模式暴露为 CLI 枚举，用户在每次会话前挑选。dsh 当前没有等价 CLI 入口；`packages/preset/` 接受任意 `preset.yml`，但开箱不附带 codex 命名预设。新 worktree 中的预设正好补上这一缺口。

这些预设不需要新增包。它们沿用既有 `preset.yml` 规约，复用既有 cordis 插件（`@deepseek-ai/dsh-persona`、`@deepseek-ai/dsh-agent-instructions`、`@deepseek-ai/dsh-tool-fs`、`@deepseek-ai/dsh-tool-fs-search`、`@deepseek-ai/dsh-tool-skill`、`@deepseek-ai/dsh-tool-bash`、`@deepseek-ai/dsh-tool-pwsh`、`@deepseek-ai/dsh-tool-apply-patch`、`@deepseek-ai/dsh-tool-jobs`）。无需改动 `packages/preset/`、`packages/core/`、`packages/session/` 或 `packages/runtime-diagnostics/`。

## 提案

把四条预设作为 master 上一条独立 commit 落地。提交位于 `apps/cli/config/agent-presets/co-{default,plan,execute,pair}/`，与该目录下其他预设并列。`packages/preset/` 下不动。

## 验收标准

- `pnpm run verify-cordis-config` 对四个新 `agent.cordis.yml` 通过；每个文件的 resolver manifest 列其依赖。
- 四个预设名与 codex 命名模式一一对应；CLI 帮助输出将它们暴露为 `--preset co-default|co-plan|co-execute|co-pair`。
- `examples/agent-spine` 下一条 snapshot 覆盖一次 `--preset co-plan` 会话：产出一份书面计划并拒绝改变状态。
- `examples/agent-spine` 下一条 snapshot 覆盖一次 `--preset co-execute` 会话：执行已批准计划且不暴露 `subagent`。

## 已考虑的替代方案

- 增加四个会话旗标而不建预设目录：拒绝。这会重复预设选择逻辑，并把工具组合藏在 CLI 代码里，而非可审查的配置中。

## 风险

预设依赖 `tool-apply-patch`，即主 RFC 的 P0-1。P0-1 未落地前，`co-execute` 与 `co-pair` 引用磁盘上尚不存在的插件；cordis resolver 会在加载时失败。缓解：把 `co-execute` 与 `co-pair` 置于与 `tool-apply-patch` 同一 overlay 之后；或接受这两条预设只在 P0-1 上线后才解析。

四条预设尚未覆盖 `codex-rs::collaboration_mode::Migrate`（codex 专属迁移助手）。若用户需要该模式，须自行编写自定义预设。四条预设不是完整对位清单；它们覆盖了 dsh 能清晰映射的那些模式。

CLI `--preset` 标志尚未在 `apps/cli/` 中暴露。预设可通过 `preset.yml` 按名加载，但用户在 CLI 上挑选需要后续补丁。验收标准第 2 条已显式列出该后续。

## 推送门

本笔记伴随本地提交；推送门按巡逻自治契约仍交由用户一侧。新 worktree HEAD `bfa855ca1f` 应并入用户当前正在权衡的推送序列决策（与另外四个 dsh worktree —— `dsh-apply-patch-2026-08`、`master` RFC、`dsh-upgrade-2026-08`、`dsh-upstream-doc-2026-08` —— 同处理）。
