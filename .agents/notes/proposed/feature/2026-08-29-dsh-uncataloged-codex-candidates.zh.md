# Agent 笔记：dsh 未编目 codex-rs 候选——扩展对齐清单

状态：proposed

[English](2026-08-29-dsh-uncataloged-codex-candidates.md) | 中文

## 问题

对齐清单 [2026-08-25-dsh-plugin-candidates](2026-08-25-dsh-plugin-candidates.zh.md) 将十个 codex-rs 表面按 P0/P1/P2 排序（`apply-patch`、`otel`、`memories`、`windows-sandbox-rs`、`dynamic-plugin-loader`、`cloud-tasks`、`connectors`、`realtime-webrtc`，加上来自 [presets 笔记](2026-08-26-dsh-collaboration-presets.zh.md) 的 `collaboration-mode-templates`）。codex-rs 工作区发布约九十个 crate；清单编目了用户可见差距最大的那些，其余隐含未列。逐 crate 通读 `codex-rs/` 后，发现还有十一个 crate 代表 dsh 当前未拥有的真实能力缝。它们不受待执行的推送包（[2026-08-28 验证](../process/2026-08-28-dsh-push-readiness-verification.zh.md)）阻塞；是下一提案周期可承接的研究候选。

本笔记扩展清单。不改动 P0-1/P0-2/P0-3，也不改动仍在等待用户推送决策的四条预设 PR。

## 发现

下表逐行列出 codex-rs crate、从 `src/lib.rs` 读得的作用、dsh 缺口、提议的候选包。优先级延续既有 P1/P2 区间；无一为 P0，因各需先有新的核心接口或外部协调，方能以 overlay 形式发布。

| codex-rs crate | 作用 | dsh 缺口 | 候选 | 优先级 |
|---|---|---|---|---|
| `codex-git-utils` | git 操作：`apply_git_patch`、`stage_paths`、`extract_paths_from_patch`、branch/baseline/info | 无一等公民 git 缝；P0-1 `tool-apply-patch` 经 `ctx.fs` 写文件但从不暂存 | `dsh-bundle-git`（`ctx.git`） | P1 |
| `codex-rmcp-client` | 完整 MCP 客户端：OAuth 发现（`StreamableHttpOAuthDiscovery`）、elicitation 客户端服务、流式 HTTP + stdio 进程传输 | dsh 消费 MCP 服务器，但无带 OAuth/elicitation 传输的完整客户端 | `dsh-rmcp-client` | P1 |
| `codex-builtin-mcps` | 产品自有内置 MCP 服务器目录（`MEMORIES_MCP_SERVER_NAME`）；运行时位置由 `codex-mcp` 掌管 | 仅有 `examples/mcp-memory`；无产品自有内置目录 | `dsh-bundle-builtin-mcps` | P1 |
| `codex-secrets` + `codex-keyring-store` | 经 OS `KeyringStore` 的、以 git 仓库根为域的秘密存储；JSON-schema 描述条目 | `packages/credentials` 仅发布 env/.env；无 OS keyring | `dsh-bundle-keyring` | P2 |
| `codex-network-proxy` | 带 cert 处理、`connect_policy`、`network_policy` 的 HTTP/SOCKS5 MITM 代理 | 无代理缝；远程入口文档在，但无可编程代理 | `dsh-bundle-network-proxy` | P2 |
| `codex-responses-api-proxy` | 独立 TCP 代理提供 responses API | `packages/api` 组装 BFF 但无独立 responses-API 代理 | `dsh-responses-api-proxy` | P2 |
| `codex-thread-store` | 以 `ThreadId` 为键的存储中立线程持久化（in-memory、live、local） | `packages/session` 掌持久化；线程概念非一等公民 | `dsh-thread-store` | P2 |
| `codex-external-agent-sessions` | 解析并导出外部 agent 会话历史（detect、ledger、records） | 会话投影在；无外部 agent 互操作导出 | `dsh-external-agent-sessions` | P2 |
| `codex-feedback` | 与 `AuthEnvTelemetry` 关联的反馈/遥测通道 | `runtime-diagnostics` 发 JSONL；无结构化反馈通道 | `dsh-bundle-feedback` | P2 |
| `codex-process-hardening` | pre-main 加固：禁用 core dump、ptrace attach，清除 `LD_PRELOAD`/`DYLD_*` | `packages/guard` 覆盖循环卫生；无原生进程加固 | `dsh-process-hardening`（native） | P2 |
| `codex-terminal-detection` | 终端元数据喂入 OTel user-agent 与 TUI 配置 | 无；并入 P1 `dsh-web-tui-bridge` | （并入） | P2 |

## 提议

将此十一行作为对齐清单的长尾分阶段。三条 P1 纳入下一提案周期；八条 P2 留作研究，待有 P1 落地后再议。

- `dsh-bundle-git` 为最高杠杆 P1：`tool-apply-patch` 已写文件内容；增 `ctx.git.stage(paths)` 即从补丁闭环到提交，无需新核心服务。缝复用 `packages/fs` 写意图与 `packages/subprocess` 调 git 二进制；不触 `packages/core`。
- `dsh-rmcp-client` 与 `dsh-bundle-builtin-mcps` 构成一对依赖：更完整的 MCP 客户端使内置服务器可注册传输（OAuth、elicitation、流式 HTTP）而无需每服务器各自粘合。先落客户端，目录随其后。
- 八条 P2 各需架构决策（新接口或外部协调）方可立包骨架。此处仅作研究；尚无 worktree。

## 已考虑之替代

- **将所有 crate 并入一条巨型 PR。** 不取。各 P1 为一缝；既有"插件，非循环改动"加"一缝一 PR"使审查可行。P0 RFC 已确立按包切分之形。
- **将 `rollout` 与 `terminal-detection` 视作独立候选。** `rollout`（`state_db`、`session_index`）与 `packages/session` 投影及 P0-2 OTel sink 重叠；`terminal-detection` 并入 TUI。单列只增清单噪音而不增新缝。
- **推迟至推送门清后再议。** 不取。此为研究行；现在编目，则用户一签推送，下一提案周期即可从 P1 中择一，而非重跑 crate 通读。

## 验收标准

- 本笔记与其中文对偶依 [i18n 约定](../../../docs/i18n/README.md) 配对；sidecar blob hash 已记录。
- 未来某 P1 提案（`dsh-bundle-git`、`dsh-rmcp-client` 或 `dsh-bundle-builtin-mcps`）引此行为缺口来源，并回链其所移植的 codex-rs crate 路径。
- 八条 P2 留于本笔记直至被提升；提升即将其移入独立 `proposed/feature/<date>-…md` 笔记，而非此处内联改写。

## 风险

codex-rs crate 作用系自磁盘检出（`E:\AI-Portable\repos\codex\codex\codex-rs`）的 `src/lib.rs` 模块清单与文档注释读得。crate 的导出表面或大于或小于模块清单所示；真实移植须读全公开 API 与测试后方定包范围。优先级为建议，非承诺。

`dsh-bundle-git` 与 `dsh-rmcp-client` 触外部二进制（git、MCP 服务器进程），而 dsh 测试架未锁定之。移植须将之声明为 test-skip 边界，而非假定其常在。

## 推送门

本笔记仅为本地。不并入等待用户推送决策的四条特性分支 PR 或 master-delta PR；[2026-08-28 验证](../process/2026-08-28-dsh-push-readiness-verification.zh.md) 中的推送执行包仍为下一可执行副作用，且仍由用户把关。