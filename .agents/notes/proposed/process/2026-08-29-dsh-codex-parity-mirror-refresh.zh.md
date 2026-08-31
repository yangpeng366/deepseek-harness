# Agent Note：dsh codex 对标镜像刷新--已校正的候选缝

状态：proposed

[English](2026-08-29-dsh-codex-parity-mirror-refresh.md) | 中文

## 问题

2026-08-25 插件候选笔记与 2026-08-26 协作预设笔记均以本地 codex 源码镜像（`E:\AI-Portable\repos\codex\codex`）为比对基础。2026-08-29 巡检发现该镜像陈旧：其本地工作区 HEAD 停在 `789b7e39dc`（2026-05-09），即上述笔记的所有对标论断实际上基于约三个半月前的 codex 快照，而非活分支。执行 `git fetch` 更新了 `origin/main` 远端跟踪引用；2026-08-31 复查发现其进一步推进至 `51ebf5b184`（"Truncate Guardian instructions after rendering the policy"，#39985）。本地工作分支未推进，仍停在 `789b7e39dc`，故本笔记的 crate 级论断以 `origin/main` 为验证基准，而非已检出工作区。2026-08-31 一次遍历在 `codex-rs/` 下计数到 141 个 `Cargo.toml` 文件。

本笔记记录刷新后的 `origin/main` 暴露的新能力缝，随后校正 2026-08-31 验证无法证实的两处缝。仅当标出的重叠深度与实现成本问题明确后，再将幸存者并入 P0/P1/P2 排序。

## 提案

记录 crate 级与模块级缝隙及其候选 dsh 缝，作为下一提案周期的证据。撤回 `guardian-context`——`codex-rs/` 中无任何路径可证实其存在。仅当标出的重叠深度与实现成本问题明确后，再将幸存者并入 P0/P1/P2 排序。

## 发现

2026-08-31 验证以 `origin/main`（`51ebf5b184`）为基准审计每一条候选缝：逐一确认其是否独立 crate，并直接通读 `prompts` 与 `agent-roles` 的导出清单。六条候选缝中，四条确认为独立 crate；一条是 `core` crate 内的模块；`guardian-context` 撤回。

### agent-roles--`core` 内模块，非独立 crate

对 `codex-rs/` 递归搜索未发现 `agent-roles` crate。其面位于 `codex-rs/core/src/config/agent_roles.rs` 与 `codex-rs/core/src/context/multi_agent_role_instructions.rs`，属 `core` crate 内部。真实导出为 `AgentRoleConfig`（类型）与 `load_agent_roles`——一个 `pub(crate)` 异步 loader，从可配置目录读取角色文件并跨 `ConfigLayerStack` 合并；`load_agent_roles_without_layers` 与 `merge_missing_role_fields` 为 crate 内部辅助。早期草稿所述 `ResolvedAgentRoleFile` 与 `parse_agent_role_file_contents` 在文件中并不存在。dsh `preset/` 支持 per-session 的 `cordis.yml` 组合，但无角色文件发现 loader，用户需逐项显式声明插件。候选 dsh 包：`preset-roles` 覆盖层，按 profile 扫描角色目录并逐文件注册为 per-session preset。与 `preset/` 确有重叠，但发现 + 解析步骤独立。移植需从 `core` 抽取 loader，而非 crate 整体替换。

### context-fragments--带注解的上下文模型

确认独立 crate。导出 `AdditionalContextDeveloperFragment`、`AdditionalContextUserFragment`、`AnnotatedContent`、`set_annotated_content`、`ContextualUserFragment`、`RenderedFragment`。该缝在上下文窗口内区分 developer/user 两种内容源，并为已渲染片段附加注解。dsh `context/` 注册 request-context 插件，但无片段/注解渲染模型，内容以拼接字符串进入提示。候选 dsh 包：`context-fragments` 插件，在组装前为片段定型，使系统提示可区分 developer 注解与用户内容。

### code-mode-runtime--进程内 V8 代码执行

确认独立 crate。导出 `InProcessCodeModeSession`、`V8JitMode`、`initialize_v8`，并再导出 `code-mode-protocol` 内容。运行时在 V8 隔离区内托管 cell actor 与 session runtime。这是最大的新颖缺口：dsh `subprocess/` 与 `shell/` 通过平台二进制做进程外代码执行，`plan/` 模式仅为记录的规划状态而非执行沙箱。旧清单中的 `v8-poc` 只是概念验证，`code-mode-runtime` 是其产品化版本。候选 dsh 包：`code-mode` 插件，以既有 `node-addon-landlock-run` native addon 作为 V8 宿主。复杂度为幸存者中最高，因需原生 V8 构建与沙箱策略；标记为最高工作量候选。

### workload-identity--基于文件的身份令牌交换

确认独立 crate。导出 `WorkloadIdentityExchange`、`WorkloadIdentityToken` 及断言交换模块。crate 读取基于文件的身份断言，将其交换为 ChatGPT 认证令牌后返回调用方。dsh `identity/` 生成匿名身份，`credentials/` 从 env 或 `.env` 读取凭据，两者均不做 workload-identity 令牌交换。候选 dsh 包：`credentials/` 下的 `workload-identity` provider，接受文件断言并通过配置的 OIDC 端点交换令牌。在令牌流上线前需先完成同意与端点验证。

### prompts--共享提示模板库

确认独立 crate。`codex-rs/prompts/src/lib.rs` 再导出 `SUMMARIZATION_PROMPT`、`SUMMARY_PREFIX`（非 `SUMMARIZATION_PREFIX`）、`PermissionsInstructions`、`ApprovalPromptContext`、`BACKEND_PROMPT`、`END_INSTRUCTIONS`，另含 `START_INSTRUCTIONS`、`goals` 三提示（`budget_limit_prompt`、`continuation_prompt`、`objective_updated_prompt`）及审查面（`REVIEW_PROMPT`、`ResolvedReviewRequest`、`resolve_review_request`、`render_review_exit_success`、`render_review_exit_interrupted`）。该 crate 还随附 `templates/` 目录，内含按流程分组的 markdown 与 xml 文件（`compact/`、`goals/`、`permissions/approval_policy/`、`permissions/sandbox_mode/`、`realtime/`、`review/`），运行时加载，而非仅类型化常量。dsh `system-prompt/` 从插件贡献组装系统提示，但无共享模板库，各插件自行持有字符串。候选 dsh 包：`prompt-templates` 插件，在 profile 目录下随附模板文件并暴露类型化槽，下游 bundle 可逐项覆写提示而无需修改源码。

### guardian-context--撤回

撤回。2026-08-31 对 `codex-rs/` 递归搜索未发现 `guardian-context` crate 或模块（`guardian_context` 与 `guardian-context` 路径匹配数为零）。"Guardian" 概念仅见于 `app-server-protocol` 模式文件（`GuardianWarningNotification.json`、`GuardianApprovalReview.ts` 及 `ThreadApproveGuardian*` 系列），而非上下文 crate。早期草稿所引"模块注释"无法证实。dsh 侧 `guardian-review` 假设仅作为无 codex-rs 源可移植的产品构想保留；其在面向模型前须自备明确的同意设计。

### history--模型历史与持久化 rollout 领域

确认独立 crate。模块注释：model-history 与 persisted-rollout 领域类型。dsh `session/` 与 `compaction/` 已覆盖持久化与压缩，此 crate 在其上增加面向模型的历史领域。与现有持久化的重叠大于其余幸存者，在领域边界更清晰前保留在研究桶。

## 确认：apply-patch 移植仍然忠实

2026-08-25 的 P0-1 apply-patch 提案保持不变。`codex-apply-patch` 依赖 `similar` 与 `tree-sitter`，不依赖 `codex-git-utils`；补丁解析与应用与 git 无关。`codex-git-utils` 是内部基础设施 crate，被十一者（analytics、app-server、chatgpt、cloud-tasks、cloud-tasks-client、config、core、core-plugins、exec、memories/write、rollout、secrets）用于基线追踪与远端规范化。它不是面向模型的工具，不影响 apply-patch 计划。

## 结论与下一步

2026-08-31 验证校正了本笔记。六条候选缝中，四条确认为独立 crate（`context-fragments`、`code-mode-runtime`、`workload-identity`、`prompts`）；`agent-roles` 是 `core` crate 内模块，非可移植 crate；`guardian-context` 在 `codex-rs/` 中无任何路径可证实，予以撤回。`history` crate 保留在研究桶。codex `origin/main` 引用现为 `51ebf5b184`，`codex-rs/` 下 `Cargo.toml` 计数 141。用户推序决策门（自 2026-08-28 起未变）仍阻塞 PR 投递；本笔记不涉及推送。下一提案周期应将四条已确认 crate 与 `agent-roles` 模块级缝与已有 P0–P2 行合并排序，并将 `guardian-review` 视为无 codex 源的 dsh 侧假设。仅当新 `rust-v` tag 落地或巡检周期重新读取 crate 清单时需再检查镜像。

## 已考虑的替代方案

- 现在重写 2026-08-25 清单：拒绝。记录新缝即可推动排序，且不会使已复核证据失效。
- 等完整通读每个实现后再记录：拒绝。crate 级事实是持久输入，更深阅读可作为明确的排序前置条件。
- 保留 `guardian-context` 为缝：拒绝。2026-08-31 搜索返回零路径匹配，无法证实的缝会污染排序。

## 验收标准

- 中英两稿承载相同的已校正候选集合（四条已确认 crate、`agent-roles` 为 `core` 模块、`guardian-context` 撤回）、注意事项、重叠问题与复查触发条件。
- 笔记区分已观察到的 Codex 事实（以 `origin/main` `51ebf5b184` 为基准验证）与未排序的 dsh 提案，并保留既有用户推送决策门。
- 双语配对 sidecar 记录两稿匹配的 blob hash。

## 风险

幸存者均从 crate 级导出与模块注释归纳，以 `origin/main` 为读取基准，未做完整实现通读；本轮仅直接通读了 `prompts` 与 `agent-roles` 的导出清单。`agent-roles`（`core` 模块）与 dsh `preset/`、`context-fragments` 与 dsh `context/` 的重叠深度需更深入阅读后方可排序。`code-mode-runtime` 需原生 V8 构建（`rusty-v8-v150.4.0` tag），与 dsh 纯 TypeScript-ESM 立场冲突，可能需新增 native addon 或进程外 V8 宿主方可符合架构。撤回的 `guardian-context` 无移植风险（无源可移）；`guardian-review` 假设若推进，则为 dsh 侧从零设计，须在面向模型前自备同意流。