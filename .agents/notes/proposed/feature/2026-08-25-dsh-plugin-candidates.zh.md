# Agent Note: dsh 插件候选 —— 弥合与 codex 的能力差距

Status: proposed

[English](2026-08-25-dsh-plugin-candidates.md) | 中文

## 问题

截至 2026-08-25，`@deepseek-ai/dsh` 在 `latest` 与 `next` 两个 npm dist-tag 上的发布版本都是 `0.1.1-rc.2`。本地 HEAD (`b150a551b8`) 与上游一致，因此没有可升的新版本。本地推广受限于与 `codex-rs` 的功能对位：在评估 dsh 与 Codex 时，用户关心的能力在当前版本里找不到。三条差距决定了这种对比：

- 编辑工具面。dsh 提供 `tool-str-replace-editor`（Aider 风格的 view / str_replace / insert），而没有 codex 的 `apply_patch`（`*** Begin Patch … *** End Patch`）格式。基于 Codex 指令集微调的模型只能改用低效的 patch。
- 跨会话持久记忆。codex 把 `memories` 与 `message-history` 设为一级 crate；dsh 只有 `compaction`，加一个 `examples/mcp-memory/` 下的 MCP 示例。
- 可观测导出。codex 自带 `otel` 与 `analytics`；dsh 仅通过 `runtime-diagnostics` 写出 session JSONL，没有 OTLP 出口。

其余差距项（`windows-sandbox-rs`、`dynamic-plugin-loader`、`cloud-tasks`、`connectors`、`realtime-webrtc`）涉及更大边界，要么需要新增 core 服务，要么需要外部协调，因此归入 P1 或 P2。

本提案列出候选清单，按差距大小与边界归属排序，并为每条 P0 设定验收标准。实施分摊到不同 worktree 与 PR；本笔记是清单与契约，不是改动集合。支撑性的差距分析位于 `D:\BaiduSyncdisk\Obsidian Vault\当前项目\02_项目推进\dsh-vs-codex-gap-2026-08-24.md`。

## 提案

每条 P0 候选都作为一个新包交付，复用既有边界与一套既有测试夹具。它们不修改 `packages/core`、`packages/session`，也不改任何 cordis 注册的核心服务。

### P0-1 `packages/fs/tool-apply-patch` —— codex `apply_patch` 数据面

面向模型的 `apply_patch` 工具，识别 codex patch 格式并通过既有 `ctx.fs` 的 write-intent gate 派发到 `packages/fs`。该工具与 `tool-str-replace-editor` 并存；模型可任选其一。`dsh-apply-patch-2026-08` 分支已在进行中（`F:\github\dsh-experiments\apply-patch-2026-08`，HEAD `3991e1f693`，round 6）。

- Parser / seek-sequence / streaming-parser / apply-core：从 `codex-rs/apply-patch/` 平移而来。66 个无密钥测试在 `npx tsx tests/*.spec.ts` 下全过（`parser 8/8`、`seek-sequence 9/9`、`apply-core 19/19`、`integration 9/9`、`streaming-parser 21/21`）。
- 待办：把 `apply.ts` 接入 `defineTool` + `ctx.inject`；把 `APPLY_PATCH_TOOL_DESCRIPTION` 抽出到 `apply_patch_tool_instructions.md`；等 `DEEPSEEK_API_KEY` 配齐后在 `examples/agent-spine` 下录制一条端到端 snapshot。
- PR 在用户确认推送后投到 `deepseek-harness/deepseek-harness`；round 1 → round 6 的本地历史是同一条线性链。

### P0-2 `packages/extensions/bundle-otel-exporter` —— `runtime-diagnostics` 的 OTLP 出口

注册一个针对 `ctx.diagnostics` 的可选 sink。Bundle 通过 gRPC 或 HTTP 将 session JSONL 事件与汇总计数推到 OTel Collector，由 cordis.yml overlay 配置。

- 仅新增包；不动 `packages/core/`、`packages/runtime-diagnostics/`、`packages/observability/`。
- OTel JS SDK 作为 peerDependency 引入，不进入核心依赖图。
- 提供一个默认 no-op 实现，bundle 默认是 opt-in。

### P0-3 `packages/extensions/memories` —— 长期记忆边界

对位 `codex-rs/memories` 的一级记忆边界。边界是一个 `ctx.memories` 接口，加一个文件系统 provider（`memories-filesystem`），落点到 `~/.dsh/memories/<profile>/`。现有的 `examples/mcp-memory` overlay（Memorix / reference-memory / Engram）改为各作为一个可选 provider，不再是唯一路径。

- 边界落在新包；provider 紧邻其侧。`compaction` 与 `session` 包保持不变。
- 新增 `memory_recall` 这一面向模型的工具，把召回内容带进下一轮；不改变 session 日志格式。
- 持久化按 profile、按 scope 隔离，强制通过 `interaction/approval` 记录显式同意；模型在未获得一次显式用户确认前不得写入持久记忆。

### P1 —— 进入下一轮提案周期，本轮 PR 不收

- `dsh-tool-request-permissions` —— 模型侧 `RequestPermissionsTool` 加 `RequestRule`，落在 `packages/interaction/`。需要新增 `ctx.permissions.request` 接口，先写一篇小型架构笔记。
- `dsh-bundle-windows-sandbox` —— 对位 `codex-rs/windows-sandbox-rs` 的 Windows 原生沙箱。独立 worktree 无法跑 Windows 验证机；交付物为 RFC 加参考实现。
- `dsh-bundle-dynamic-plugin-loader` —— 对位 `codex-rs/plugin/` 的运行时安装路径。与 `extensions/`、`bundle/`、新增的 permissions 边界共同组合；没有该边界就不能开工。
- `dsh-web-tui-bridge` —— 给 Web UI 加可选 TUI 表面，复用 `packages/host`。由 OpenEyes 与 patrol 工作流驱动。

### P2 —— 仅作调研

- `dsh-bundle-cloud-tasks` —— 对位 `codex-rs/cloud-tasks`。需要 `api/` 加 `sdk/` 对齐。
- `dsh-bundle-connectors` —— OAuth 连接器目录。与 `credentials/` 与 `settings/` 强耦合；先做隐私审查。
- `dsh-realtime-webrtc` —— 音频、视频实时通道。超出当前 Web UI 的形态。

## 已考虑过的替代方案

### **把 `codex-rs` 作为运行时依赖 vendoring，通过 FFI 调用**

放弃。dsh 跑的是 TypeScript ESM；codex-rs 跑的是 Rust。二者之间走 FFI 会让 dsh 失去目前对依赖更新的克制。能力边界仍留在 dsh；把 Rust 平移到 TS 可以同时干掉跨语言边界和随之而来的跨进程协调层。

### **fork dsh，以另一个名字发布平行版本**

放弃。仓库说明里写着「Pre-release stance: foundation over blast radius — rename or repackage freely」。Fork 只为一位用户解决差距，把其他人留在原地。本提案把候选回写到源仓库。

### **等上游打 stable 标签再说**

放弃。今天用户对比的就是这份差距。等下去并不能弥合差距。P0 清单是当前 `0.1.1-rc.2` 上让 dsh 与 codex 在评估层面同台的最小集合。

### **把候选放进 `packages/core` 而不是新包**

放弃。仓库规约「Plugins, not loop changes: new behavior goes on documented extension points; changing `agent-loop` requires updating docs/architecture.md」把 `packages/core` 视为独立一层。新包能让接口保持稳定，也让 PR 一次只对照一个边界。

## 验收标准

- 每个 P0 包脚手架落盘后，worktree 内 `pnpm run build` 与 `pnpm run verify-package-invariants` 通过，且不修改 `packages/core/`、`packages/session/`、`packages/runtime-diagnostics/`、`packages/observability/`。
- P0-1：`packages/fs/tool-apply-patch` 导出一个 `apply_patch` 工具；既有 66 个测试保持绿；新建的 `apply_patch_tool_instructions.md` 被工具描述引用；`examples/agent-spine` 下用真实模型录一条端到端 patch snapshot。
- P0-2：`packages/extensions/bundle-otel-exporter` 注册一个可选 sink；未设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时 bundle 为 no-op；设置后，每个 `runtime-diagnostics` 事件与一条 session 汇总计数在 5 s 内到达 collector。
- P0-3：`packages/extensions/memories` 暴露 `ctx.memories`；filesystem provider 在 `~/.dsh/memories/<profile>/` 下往返一条记录；`memory_recall` 工具为当前会话返回 scope 内的记录；同意通过 `interaction/approval` 记录，模型无法绕过。
- 三条 P0 在同一 PR 内各自新增一篇 `implemented/feature/<date>-…md` Agent Note，附带 `.zh.md` 对照件；仅在需要新分类时更新 `scripts/agent-note-tree.ts`。
- 中文版按 [i18n 契约](../../../docs/i18n/README.md) 与本文件逐节对齐；`pnpm run verify-translation-pairing --write` 写入 sidecar blob 哈希。

## 风险

`0.1.x` 分支仍属预发布。改 `core`、`session`、`compaction` 的 patch 会撞上 `feature/image-management-strategy` 跟踪的 `0.1.2-rc` 重构。本提案把范围限制在新包来回避风险；新包在上线成为 overlay 之前不会吸收上游 API 变动，而 overlay 位于 cordis.yml 之后。

P0-1 的 `apply_patch` 与 `tool-str-replace-editor` 并存。若两个工具在同一 session 同时被声明，模型可能选一个、UI 渲染另一个。缓解：`apply.ts` 只接受 `apply_patch`；编辑器只接受 str_replace；两者都通过 `ctx.fs` write-intent 写入；同一轮内禁止同一路径被两种工具同时打开。

P0-3 的持久记忆会影响跨会话行为。若模型误写敏感条目，该条目将持续存在。缓解：按 profile 隔离、按 scope 命名空间、首次写入强制 `interaction/approval`、新增 `dsh memory prune` 控制台命令遍历当前 profile。

P0-2 的 OTel sink 在 collector 端点配置错误时可能把 session 内容泄露给第三方。Bundle 默认 `127.0.0.1:4317`，且在端点为 `0.0.0.0` 或公网主机名、且 cordis.yml overlay 未显式给出 `--allow-external` 标记时拒绝启动。

未取得用户明确确认就推送 P0 PR，违反本巡逻行记录的自治契约。apply-patch worktree 的 round 6 已铺好第一条候选；推送闸门留在用户一侧。