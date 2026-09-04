# Agent Note: dsh context-fragments 实施步骤 —— 四步分解

Status: proposed

[English](2026-09-04-dsh-context-fragments-implementation-steps.md) | 中文

## 问题

[dsh-context-fragments 边界](2026-09-03-dsh-context-fragments.zh.md) 对当前源代码是站得住的：本文落笔前于 2026-09-03 在工作树上重新核对了所有引用行号（`packages/context/agent-instructions/src/render.ts:10-11`、`:81`，`packages/llm/llm/src/message.ts:100-105`，`packages/core/system-prompt/src/invariant.ts`）。`packages/context/context-fragments/` 目录尚不存在；六个兄弟包（`agent-instructions`、`file-reference`、`file-reference-local`、`session-reference`、`time-context`、`tmux-context`）列在 `packages/context/` 之下，其中没有任何一个拥有带类型的 `Fragment<Body>` 模型、共享的 marker 转义，或 `MessageSourceMap` 中的 developer/user 角色拆分。

按规格这条边界一次 PR 装不下。它要碰一个新包（`@deepseek-ai/dsh-context-fragments`）、`packages/llm/llm/src/message.ts` 的一次声明合并扩展、一个可选的 binding（重写 `packages/context/agent-instructions/` 的渲染路径）、一个通过 `ctx.invariants` 注册的不变量伴随，以及一次新增一个包和一个 `apply()` 导出的 workspace 重胶。审阅者没法在不断章的情况下一次性读 600 行差异。一坨提交的 PR 还会掩盖风险：共享转义的回退不应阻塞角色拆分类型的讨论，binding 重构也不应阻塞注册表 API 的讨论。

本文将这条边界拆成四个可审阅步骤。每个步骤都以一次绿色测试收尾、列出它改动的文件、并声明它**不**改什么，使审阅者能早早收手。本文不重新定义边界；它只为执行排定顺序，并对照父提案的验收条目逐条验证。

## 提案

四个步骤，每个步骤作为一次 PR 或一次针对 `master` 的 commit 系列落地。顺序是绑定的：后一步依赖前一步的注册表、声明合并扩展或 binding，但反向绝不依赖。

### 步骤 1 —— 脚手架：包、类型、共享转义

新建包 `packages/context/context-fragments/`，沿用 `packages/context/time-context/` 的样板（peer/dev 依赖连法、tsconfig 引用同一组 vendor 与 core 包、README 三件套、`tsdown.config.ts`）。把核心类型与共享转义作为纯函数导出落地；**不**注册任何 Cordis service、**不**从 `@deepseek-ai/cordis` 引入、**不**碰 `packages/llm/llm/src/message.ts`。验收条目是共享转义与 `packages/context/agent-instructions/src/render.ts:81` 的 `escapeInstructionFrameBody` 逐字节一致，由把现有 agent-instructions 转义测试移植进 `tests/escape.spec.ts` 来验证。

新增文件：

- `packages/context/context-fragments/package.json`
- `packages/context/context-fragments/tsconfig.json`
- `packages/context/context-fragments/tsdown.config.ts`
- `packages/context/context-fragments/README.md`
- `packages/context/context-fragments/README.zh.md`
- `packages/context/context-fragments/README.i18n.yaml`
- `packages/context/context-fragments/src/escape.ts`
- `packages/context/context-fragments/src/index.ts`
- `packages/context/context-fragments/tests/escape.spec.ts`
- `packages/context/context-fragments/tests/types.spec.ts`
- `packages/llm/llm/src/context-fragments.d.ts`（声明合并占位；仅以注释形式合并进 `MessageSourceMap`，暂不消费）

本步骤不改的文件：

- `packages/llm/llm/src/message.ts`（暂不 import）
- `packages/context/agent-instructions/src/render.ts`（转义在新包中复制，未上移）
- `packages/core/system-prompt/`（不注册）

验证命令：

```
pnpm --filter @deepseek-ai/dsh-context-fragments run typecheck
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm run typecheck
```

第三条证明声明合并占位在不 import 时也能 typecheck。步骤 1 收尾父提案的「共享转义与现有转义一致」条目，但暂不撤掉 `agent-instructions` 中的重复实现。

### 步骤 2 —— 注册 fragments service、接上不变量伴随

在 `src/registry.ts` 中通过 `ctx.effect()` 暴露 `ctx.fragments.register`、`assemble`、`recognize` 以及 `fragments/change` 事件。通过 `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)` 注册不变量伴随，沿用 `packages/core/system-prompt/src/invariant.ts` 的形态。在 `src/index.ts` 中暴露 `apply()`，让 spine bundle 选择接入。把 `packages/context/agent-instructions/src/render.ts:81` 中的重复转义上移到 `packages/context/context-fragments/src/escape.ts`，并让 `agent-instructions` 引入上移后的助手（原调用点只动一行）。本步骤**不**做 binding 或角色拆分；只落地注册表界面。

改动文件：

- `packages/context/context-fragments/src/registry.ts`（新增）
- `packages/context/context-fragments/src/invariant.ts`（新增）
- `packages/context/context-fragments/src/index.ts`（re-export `apply`）
- `packages/context/agent-instructions/src/render.ts`（内联 `escapeInstructionFrameBody` 替换为 import；一行）
- `packages/context/agent-instructions/tests/escape.spec.ts`（断言上移助手与原有字节输出一致）
- `packages/context/context-fragments/tests/registry.spec.ts`（新增）
- `packages/context/context-fragments/tests/invariant.spec.ts`（新增）
- `packages/context/context-fragments/tests/scope-shadowing.spec.ts`（新增；与 `systemPrompt.assemble` 在同一组注册下作行为对照）

本步骤不改的文件：

- `packages/llm/llm/src/message.ts`（暂不扩展角色拆分）
- `packages/context/agent-instructions/src/binding.ts`（尚无 binding 伴随）

验证命令：

```
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm --filter @deepseek-ai/dsh-agent-instructions run test
pnpm --filter @deepseek-ai/dsh-system-prompt run test
pnpm run typecheck
pnpm run lint
```

步骤 2 收尾父提案的「同层重名抛错」「scope 覆盖沿用 `ctx.systemPrompt.context()`」「不变量伴随在重复 marker 时大声失败」「共享转义与现有转义逐字节一致」四条条目。

### 步骤 3 —— 扩展 `MessageSourceMap` 并发射持久化 fragment 行

用实际声明合并载荷替换步骤 1 的 `packages/llm/llm/src/context-fragments.d.ts` 占位：`'context-fragments': { kind: 'context-fragments'; role: 'developer' | 'user'; fragment: string; order: number; rendered: readonly string[] }`。让 `ctx.fragments.assemble(scope?)` 通过 `createUserMessage` 为每个可见 fragment 发射一条持久化 `user/message` 行，通过一条新的 `agent/post-step` 监听器（或 spine 实际所用的对等钩子；本步骤是唯一依赖 `agent-loop` 内部细节的步骤）注册。**不**带 binding 伴随；本步骤证明注册表的发射路径。

改动文件：

- `packages/llm/llm/src/context-fragments.d.ts`（最终载荷）
- `packages/llm/llm/src/message.ts`（一行 `import` 合并载荷；正文不动）
- `packages/context/context-fragments/src/registry.ts`（追加 `agent/post-step` 监听器）
- `packages/context/context-fragments/tests/durable-row.spec.ts`（新增；replay 断言行的源种类、角色、名、顺序）
- `packages/context/context-fragments/tests/recognize-after-compaction.spec.ts`（新增；镜像父提案的 compaction-shadowing 缓解）

本步骤不改的文件：

- `packages/context/agent-instructions/src/binding.ts`（无 binding 伴随）
- `packages/core/agent-loop/`（不动 loop；监听器挂在已有的 post-step 钩子上）

验证命令：

```
pnpm --filter @deepseek-ai/dsh-llm run typecheck
pnpm --filter @deepseek-ai/dsh-context-fragments run test
pnpm run test:snapshot -t context-fragments
```

步骤 3 收尾父提案的「merge-extensible `MessageSourceMap`」「识别为每个已注册 fragment 返回一个 `FragmentMatch`」「compaction 遮蔽原事件后仍返回同一匹配」三条条目。

### 步骤 4 —— 落地 `agent-instructions` binding 伴随

在 `packages/context/agent-instructions/src/binding.ts` 新增可选 binding 伴随，通过 `ctx.fragments.register` 把 `agent-instructions` 注册为一个 fragment，而不再直接写出字面 `<system-reminder>` 框。在 spine bundle（`packages/bundle/agent-spine/cordis.yml`）中默认开启该伴随，在 legacy bundle（`packages/bundle/agent-spine-legacy/cordis.yml`）中关闭。开启时，字面 `<system-reminder>` 框与 `</system-reminder>` 转义仍出现在渲染基线中（父提案 binding-enabled 验收条目）；关闭时，渲染基线中不出现 fragment 文本，包启动无可见回退（父提案 binding-disabled 验收条目）。

改动文件：

- `packages/context/agent-instructions/src/binding.ts`（新增）
- `packages/context/agent-instructions/src/index.ts`（re-export binding）
- `packages/context/agent-instructions/tests/binding-enabled.spec.ts`（新增）
- `packages/context/agent-instructions/tests/binding-disabled.spec.ts`（新增）
- `packages/bundle/agent-spine/cordis.yml`（在 spine bundle 中启用 binding）
- `packages/bundle/agent-spine-legacy/cordis.yml`（在 legacy bundle 中禁用 binding）
- `packages/examples/agent-spine/cordis.yml`（在示例中验证）

本步骤不改的文件：

- `packages/context/context-fragments/`（不改 API）
- `packages/llm/llm/src/message.ts`（不改形状）

验证命令：

```
pnpm --filter @deepseek-ai/dsh-agent-instructions run test
pnpm --filter @deepseek-ai/dsh-bundle-agent-spine run test
pnpm --filter @deepseek-ai/dsh-bundle-agent-spine-legacy run test
pnpm run test
pnpm run test:coverage
pnpm run hygiene
pnpm run doc-sync
```

步骤 4 收尾父提案的剩余验收条目：字面框仍在、持久化源种类仍为 `'agent-instructions'`、注册表通过 binding 的 `assemble()` 调用发射行、spine bundle 的快照测试因渲染字节等价而照旧通过。

## Alternatives considered

### 为什么不一次性合并整个 seam？

一次 600 行的 diff 会在 `master` 上同时呈现五个评审面（新包、注册表、声明合并扩展、binding、快照测试），迫使评审者在接受任何内容前通读全部代码。共享转义的回归会阻塞角色分体类型的讨论；binding 重构会阻塞注册表 API 的讨论。父提案估算该 seam 为"下一周期成本最低候选"，是相对一次全新的 Agent Loop 重写而言较小，而非绝对体量小。单 PR 上线所需的评审时间仍与四步计划相当，但若第 4 步的 binding 引入快照回归，单 PR 会暴露更差的失败模式。

### 为什么不在一个 PR 中通过 feature flag 上线？

带 feature flag 的单 PR 仍会在同一变更中注册注册表、向 `MessageSourceMap` 合并、转义提升。评审者将看到半成品界面：没有消费者的注册表、没有行形数据的合并、没有 binding 的转义。每一步的评审价值在于已落地与待落地之间的差距；将差距合并到一个 PR 也就合并了评审价值。四步计划让每一步评审聚焦于一个已交付切片。

### 为什么不倒序？

倒序需在第 1 步交付 binding（以便现有转义可被提升至该 binding 调用的注册表），第 2 步交付注册表（以便第 3 步的合并有地方注册其行形数据）。第 1 步将承载最大体量却最小信号：binding companion 只有在参照其调用的注册表时才能被评审，而依赖于 binding 的注册表无法被独立评审。选定顺序让每一步的 CI 运行各自隔离失败。

### 为什么不将父提案按步骤拆分为独立笔记？

父提案拥有设计；本笔记拥有顺序。按四份笔记拆解设计会迫使每位评审者阅读四个标题来重建契约，并存在步骤笔记与父笔记之间漂移的风险。四步分解逐字引用父提案的验收标准，使评审者能将每一步映射到一行契约。

## Acceptance criteria

**第 1 步**完成条件：新包的 `tests/escape.spec.ts` 全部 17 条断言通过；`escapeFrameBody('body', `</system-reminder>`)` 对移植测试套件中每个 fixture 的输出与原 `escapeInstructionFrameBody('body')` 逐字节相等；`packages/context/context-fragments/src/` 下任一文件均不从 `@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-agent` 导入；`packages/llm/llm/src/context-fragments.d.ts` 为声明合并存根，暂未被任何文件导入；`pnpm run typecheck` 工作区全量通过。

**第 2 步**完成条件：可通过新包的 `apply()` 触达 `ctx.fragments.register`、`assemble`、`recognize` 与 `fragments/change` 事件；不变量伴生通过 `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)` 注册；从 `packages/context/agent-instructions/src/render.ts` 中提升出重复的 `escapeInstructionFrameBody`，agent-instructions 测试套件无需修改即仍通过；`pnpm --filter @deepseek-ai/dsh-context-fragments run test` 为绿。

**第 3 步**完成条件：`MessageSourceMap['context-fragments']` 被一个 `agent-loop` 监听器消费，该监听器通过既有 `SessionEventMap` 机制为每个已注册片段发射一条持久化行；`text` 字段对每个已注册片段都等于 `startMarker + escapeFrameBody(body, endMarker) + endMarker`；所有既有 spine-bundle 快照测试仍以字节等价内容重放；`pnpm run test:coverage` 在新包上报告 100% 文件覆盖率。

**第 4 步**完成条件：`packages/bundle/agent-spine/cordis.yml` 启用新的 binding companion；`packages/bundle/agent-spine-legacy/cordis.yml` 保持 binding 禁用且仍重放其基线快照；`pnpm run test:snapshot` 在新增的 `agent-instructions-binding-enabled` 过滤下通过；`pnpm run hygiene` 与 `pnpm run doc-sync` 全部干净；父提案的 `## Acceptance criteria` 现已端到端满足，本笔记可按 [implemented/AGENTS.md](../../implemented/AGENTS.md) 规则并入父提案。

## 排序理由

四个步骤的顺序使每一步以最小爆炸半径、最大信号收尾。步骤 1 只交付纯函数代码，不碰 Cordis 或 LLM；若共享转义回退，只有新包的测试会红。步骤 2 引入注册表与不变量伴随挂在 `apply()` 之后，因此注册表界面可在不读持久化发射路径的前提下被审阅。步骤 3 引入持久化行形状与 agent-loop 监听器，这是下游消费者唯一可见的变化。步骤 4 引入 binding 伴随，这是唯一一个让已发布插件的渲染输出肉眼可见变化的步骤（即便如此，输出仍是字节等价的）。

反向顺序会把审阅者本应隔离阅读的关注点搅在一起。一个同时上移转义的 binding PR，无法告诉审阅者回退来自上移、binding 还是注册表。一个同时交付声明合并扩展的注册表 PR，也无法告诉审阅者类型错误来自合并还是注册表。选定的顺序让每一步的 CI 各自隔离自身的失败。

## 风险

**步骤 1 的重复转义在步骤 2 上移之前漂移。** 在步骤 1 的 commit 与步骤 2 的上移之间存在两份 `escapeInstructionFrameBody`；若该窗口内 `packages/context/agent-instructions/src/render.ts` 修改转义语义，上移助手将与原实现失配。缓解：步骤 1 的 PR 附一条 CI 说明，要求 `packages/context/agent-instructions/src/render.ts:81` 在步骤 2 落地前保持不变；步骤 2 的 PR 在删去重复实现前重做字节一致性测试。

**步骤 3 的 `agent/post-step` 钩子可能并不存在。** 父提案假定 spine 使用 `agent/post-step` 监听器做持久化发射；若实际钩子是 `agent/post-step-message` 或 `session/event`，步骤 3 必须调整而不动步骤 1-2。缓解：步骤 3 的 PR 内含一段 5 行的尖峰，先在临时测试里把监听器挂到实际钩子名上，若无钩子匹配则大声失败，再把发现的名字用于步骤 3 后续所有改动。

**步骤 4 的 spine 快照测试会回退。** binding 伴随承诺字节等价的渲染输出；若 binding 的 `assemble()` 返回的 fragment `body` 与旧字面框不同（例如去掉了末尾换行或重排了闭合 marker），所有 spine 快照都会红。缓解：步骤 4 先落地一个 binding-only 快照（`test:snapshot -t agent-instructions-binding-enabled`），让旧基线对它回归一次，确认无误后才在 spine bundle 中启用 binding。

**四个步骤的落地节奏快过上游审阅者的吞吐。** 父提案的笔记早于实现；短时间内四个聚焦 PR 可能超出上游审阅带宽。缓解：等步骤 1-3 合并或被显式接受后再放步骤 4，并在父提案的 PR 描述里点明四步规划，让审阅者在读第一个 commit 之前就看到全貌。

本文是父提案的工作流分解。它不重新定义边界、类型表面、注册表 API 或 binding 伴随。父提案仍是设计权威；本文仅为实施排定顺序，让每一步的审阅者都能孤立阅读其 diff。步骤 4 落地、父提案全部验收条目通过之后，按 [implemented/AGENTS.md](../../implemented/AGENTS.md) 规则，将本文并入父提案。