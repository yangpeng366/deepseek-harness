# Agent Note: dsh context-fragments 边界 —— 带注解、角色化的请求上下文

Status: proposed

[English](2026-09-03-dsh-context-fragments.md) | 中文

## 问题

`packages/context/` 注册的 request-context 插件均以 user-role `user/message` 行提供内容，但每个贡献者各自维护 framing 与识别。`agent-instructions` 用硬编码 `<system-reminder>` 对作为开头，并转义指令正文、路径、scope 与 budget-marker 文本中的字面 `</system-reminder>` 子串，防止仓库自有内容提前关闭插件拥有的 frame（见 `packages/context/agent-instructions/src/render.ts:10-11`）。`time-context`、`tmux-context` 以及 `session-reference/` 中的 per-session snapshot 助手各自由自己拼接文本，却没有该转义。`system-prompt` 的 `context()` 注册表把动态贡献拼成一个无序的运行时快照，既无 marker，也无角色区分，更没有供后续代码识别先前注入内容的协议。

Codex 同源 crate `codex-rs/core/src/context/fragment.rs` 定义了 `ContextualUserFragment` trait，由 `ROLE`、`START_MARKER`、`END_MARKER`、`body()` 精确描述一项贡献；外加 `FragmentRegistration` 类型擦除的匹配器，使下游代码无需重建 payload 即可识别自己的先前注入。模型可见差异在于：developer-role 内容与 user-role 内容分属不同类型，因此 `HookAdditionalContext` 可作为 developer-role 材料出现，`AppsInstructions` 这样的 fragment 可携带自己的开闭标记，但仍作为同一有序 user-role 行。最新刷新的 [镜像笔记](../process/2026-08-29-dsh-codex-parity-mirror-refresh.zh.md) 将 `dsh-context-fragments` 列为下一周期成本最低的候选，原因正是该边界映射到单一新包且无需原生依赖。

三个独立的问题要求三种独立的修复：

1. **Marker 重复。** `<system-reminder>` 开闭对只是一个内联字符串常量。如果第二个插件也想使用可识别 frame，要么复制同一对（于是两个贡献者可能被误认为一个），要么另起新对（识别规则随即分裂）。共享的 fragment 边界拥有 marker 命名空间与统一的转义实现。
2. **角色歧义。** 所有现有贡献者都发出 `user/message`，但下游消费者（权限 hook 想要读取仅 developer 的内容；compaction 想要对 developer-role 文本做比 user-role 文本更强的保留；未来的 Client 想要把 developer 上下文渲染为内联注解而非系统提示之外的一节）无法区分 developer 与 user 内容。当前 `packages/llm/llm/src/message.ts:100-105` 中的 `MessageSourceMap` 仅声明 `user`、`plugin`、`model`、`tool`，无角色拆分。
3. **识别不可能。** `system-prompt.context()` 评估 provider 后，结果是一段字符串，写入 `PromptAssembly.contexts[].text`。后续若想识别先前注入内容，必须重新执行同一 provider 才能再次生成该字符串，而时间已过、cwd 已改、凭据文件已轮换，重算常常不可行。Codex 匹配器的解法是识别持久化消息体里的开闭对；dsh 尚无对等机制。

plugin-candidates 笔记已把该边界列为 P1 下一周期工作，并把它放在 `packages/context/` 下。本文负责这条边界。

## 提案

新增包 `@deepseek-ai/dsh-context-fragments`，位置 `packages/context/context-fragments/`。该包拥有：

- 一份带类型的 `Fragment<Body>` 贡献模型，包含 `role`、`startMarker`、`endMarker`、`order`、`body`；其中 `role` 为 `'developer' | 'user'`。`render()` 助手直接拼接 marker 与 body，不补空白，因此需要分隔符的贡献者须自行把分隔符放进 `body`。
- `ctx.fragments.register(fragment)` API，其分层规则与 `ctx.systemPrompt.context()` 一致：global 贡献与 scope-keyed 贡献同存，nearest scope 覆盖同名者；同层内重名抛错。返回值为精确的 Cordis effect disposer；注册表在变更时发出 `fragments/change`。
- `ctx.fragments.assemble(scope?)` API，按 `order` 升序解析每个可见 fragment，返回类型化 `RenderedFragment[]`，并对 body 应用共享 marker 转义，使不可信 `body` 文本无法关闭插件拥有的 frame。
- `ctx.fragments.recognize(text)` API，对每个 marker 包裹文本的已注册 fragment 返回一个 `FragmentMatch`，匹配过程与 body 内容无关。识别对内容保持盲态：同层中两个 marker 完全相同的 fragment 永不允许并存；marker 为空的 fragment 永不会匹配任意文本。
- 通过声明合并扩展 `MessageSourceMap`（`packages/llm/llm/src/message.ts:100`），新增键 `'context-fragments': { kind: 'context-fragments'; role: 'developer' | 'user'; fragment: string; order: number }`，使持久化 fragment 行携带源种类、角色、fragment 名与装配顺序。

出厂循环不直接消费 fragment。另一独立 companion `context-fragments/binding` 默认关闭，作为 `agent-instructions` 的可选绑定示例：启用后，`agent-instructions` 在其 baseline 步骤里调用 `ctx.fragments.assemble()`，按 `order` 将每个渲染 fragment 折叠进既有的 `<system-reminder>` body，最终序列化为单一 `user/message`，源种类保留 `'agent-instructions'`（从而保留现有 typed changes），`body` 则来自渲染片段数组。匹配字面 `<system-reminder>` frame 与 `</system-reminder>` 转义的既有测试保持通过。该绑定可选，因此该边界落地时不会扰动 `time-context`、`tmux-context`、`session-reference`。

共享转义与 `packages/context/agent-instructions/src/render.ts` 中既有的算法相同。该包把转义提升为 `ctx.fragments.escape(text, marker)`，让未来所有贡献者复用同一实现。转义将每个与 `marker` 完全相等的字面子串替换为 `<\` + `marker.slice(1)`（闭标签走 `marker.replace(/^<\//, '<\\/')`），与既有测试一致。

新增 invariant companion `context-fragments-invariant`，在已装配 fragment 落定之后运行，并在以下情况响亮失败：

- 两个可见 fragment 声明相同的非空 start marker；
- fragment body 经转义后仍含自身的 start 或 end marker；
- fragment role 既非 `'developer'` 也非 `'user'`；
- `order` 在同层内为非有限数或重复。

该 invariant companion 遵循 `system-prompt/invariant` 既有约定（见 `packages/core/system-prompt/src/invariant.ts`）；它不修改注册表与渲染结果，只负责响亮失败。

## Fragment 形状（类型化贡献）

```ts
export type FragmentRole = 'developer' | 'user'

export interface Fragment<Body = unknown> {
  readonly name: string
  readonly role: FragmentRole
  readonly order: number
  readonly startMarker: string
  readonly endMarker: string
  readonly body: Body
}

export interface RenderedFragment {
  readonly name: string
  readonly role: FragmentRole
  readonly order: number
  readonly startMarker: string
  readonly endMarker: string
  readonly text: string
  /** Marker-escaped body, with start/end markers prepended and appended. */
  readonly rendered: string
}

export interface FragmentMatch {
  readonly name: string
  readonly role: FragmentRole
  readonly text: string
}
```

注册表对 `body` 不强加类型；`render()` 由贡献方提供，注册表在 `assemble()` 中调用。上面形状锁定该边界；注册表不试图对 `body` 归一化。需要结构化 body 的贡献者可通过声明合并在自己的模块上扩展 `Fragment<Body>`，使注册表始终保持可合并扩展。

## 识别协议

识别是对一段字符串与已注册 marker 集合的纯函数。协议：

- 任何 `startMarker` 或 `endMarker` 为空的 fragment 永不会匹配。空对是文档化的「未标记 fragment」出口；未标记 fragment 仅凭持久化源种类识别，从不靠文本匹配。
- start、end marker 均非空的 fragment，当输入的非空前缀等于 `startMarker`（大小写不敏感）且非空后缀等于 `endMarker`（大小写不敏感）时，匹配成功。
- 识别按 `order` 升序为每个已注册 fragment 返回一个 `FragmentMatch`，匹配子串写入 `text`。同层中 marker 完全相同的 fragment 永不允许并存；invariant companion 在注册阶段强制该规则，使 `recognize()` 保持确定性。
- `recognize()` 不重新执行 provider，也不查询持久化历史。仅依赖 marker 对，因此即使在 compaction 之后识别仍能命中。

匹配模型刻意收紧：它只识别 frame，不识别含义。想要「替换我上次注入」的贡献者调用 `recognize()`，读取 `RenderedFragment.name`，然后重新注册新 body；持久化日志保留旧 frame，直到该贡献者发出新事件。想要「追加我上次注入」的贡献者在设计阶段即被拒绝：fragment 是原子的，长大必须重渲。

## Message source map 扩展

新的源种类通过声明合并加在 `packages/context/context-fragments/src/message-source.d.ts`，由 `packages/llm/llm/src/message.ts` 单点导入：

```ts
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'context-fragments': {
      kind: 'context-fragments'
      role: 'developer' | 'user'
      fragment: string
      order: number
      rendered: ReadonlyArray<{ name: string; role: FragmentRole; text: string }>
    } & ContextFormed
  }
}
```

该扩展可合并扩展，未来包可增加各自的角色化种类而不与本项冲突。既有 `MessageSource = MessageSourceMap[keyof MessageSourceMap]` 自动接入新种类。`ContextFormed` 基类保持持久化日志与其他 plugin 源对称。

扩展落在独立 `.d.ts`，因此未依赖 `@deepseek-ai/dsh-context-fragments` 的消费者在类型层面仍保有原闭合 map。需要声明 fragment 专属 Cordis 事件（例如 `fragments/change`）的代码在同一 `.d.ts` 中声明，使类型层表面始终由该边界所属的包持有。

## 与 system-prompt 和 agent-instructions 的协同

`system-prompt/context()` 与 `ctx.fragments.register()` 是有意区隔的两条表面。分工如下：

- `system-prompt/context()` 输出一段有序运行时上下文快照，由注册表拼接成一段字符串，并在 `includeRuntimeContext` 为真时并入系统提示。它适合随系统提示一并出现、被模型视为部署级指导的内容。
- `ctx.fragments.register()` 输出一段带类型、带 marker frame、带角色类型的行，进入持久化的 user/developer 角色历史。它适合必须与系统提示区分（hook 注入的 developer 注解、权限提醒、apps-instructions 块）且后续代码必须能识别的内容。

两条表面不共享 order 空间。选择 fragment 的贡献者拥有 fragment 层的 order；选择 system-prompt 运行时上下文的贡献者拥有 `PromptContext` 层的 order。Agent loop 在装配系统提示之前先把 fragment 渲染进持久化消息流，因此 fragment 的 developer-role 行独立于系统提示运行时上下文对模型可见。这与 Codex 的拆分一致：developer fragment 作为独立的 `ResponseItem` 出现，其 role 即 fragment 的 `ROLE`。

`agent-instructions` 保留自身的源种类（`'agent-instructions'`），因此持久化的 typed changes（`AgentInstructionChange[]`）仍是可信记录。当可选绑定启用时，`agent-instructions` 调用 `ctx.fragments.assemble()`，把渲染文本折叠进既有的 `<system-reminder>` body，保留既有测试钉死的字面 marker 对。新增测试 `packages/context/context-fragments/tests/binding.spec.ts` 验证：禁用绑定时，agent-instructions baseline 中不出现任何 fragment 渲染文本。

## 迁移集合

| 贡献者 | 迁移前 | 迁移后 | 备注 |
|---|---|---|---|
| `agent-instructions` baseline | 内联 `<system-reminder>` 开闭与转义（`packages/context/agent-instructions/src/render.ts:10-11`） | `ctx.fragments.register({ name: 'agent-instructions', role: 'user', order: 0, startMarker: '<system-reminder>', endMarker: '</system-reminder>', body })`，且 spine bundle 默认启用 binding companion | 转义上移至 `ctx.fragments.escape`。字面 frame 保留，既有测试仍通过。body 由既有 intro 与各文件 sections 与组装 fragment 文本拼接而成。 |
| `time-context` 运行时快照 | `ctx.systemPrompt.context()` 返回当前时间行 | `ctx.fragments.register({ name: 'time-context', role: 'user', order: 50, startMarker: '<time-context>', endMarker: '</time-context>', body })`，body 返回当前时间行 | 运行时上下文贡献者从 `system-prompt/` 移除。后续通过 `<time-context>` marker 识别，而非单凭持久化源种类。 |
| `tmux-context` 运行时快照 | `ctx.systemPrompt.context()` 返回 tmux pane 行 | `ctx.fragments.register({ name: 'tmux-context', role: 'user', order: 50, startMarker: '<tmux-context>', endMarker: '</tmux-context>', body })` | 形状与 `time-context` 相同；每包独占 marker 对。 |
| Hook 附加上下文（未来） | dsh 当前尚无 | `ctx.fragments.register({ name: 'hook-additional-context', role: 'developer', order: 0, startMarker: '', endMarker: '', body })` | 未标记的 developer-role fragment；识别靠持久化源种类，不靠文本。这是 codex-rs `HookAdditionalContext` 的对应项。 |
| Apps instructions（未来） | dsh 当前尚无 | `ctx.fragments.register({ name: 'apps-instructions', role: 'user', order: 100, startMarker: '<apps-instructions>', endMarker: '</apps-instructions>', body })` | body 承载静态「Apps (Connectors) can be explicitly triggered...」块。对位 `codex-rs/core/src/context/apps_instructions.rs`。 |

表内每行为一次纵向提交：注册表面、包级 README 更新、声明合并 sidecar、（如适用）binding companion、测试。新贡献者只需引入 `@deepseek-ai/dsh-context-fragments` 并调用 `ctx.fragments.register(...)`；该边界足够小，添加一项贡献只是一次调用加一份合并扩展类型。

## 暂缓迁移的贡献者

| 贡献者 | 暂缓原因 | 恢复触发条件 |
|---|---|---|
| `session-reference` snapshot 助手 | 该有界快照刻意以结构化 payload（session id、scope、projection envelope）序列化；marker-frame 字符串会丢失结构化形式。该贡献者继续以现有 typed 源种类发出 `user/message` 行。 | 若未来一版要把快照文本暴露为 fragment，须保留结构化 projection；此前 snapshot 助手保留在 `MessageSourceMap['session-reference']` 上。 |
| 技能目录渲染 | 技能指导以 `systemPrompt.context()` 贡献者出现，因其文本针对活技能目录渲染，并在 `includeRuntimeContext` 为真时有意成为系统提示的一部分。技能目录本身不属于 developer/user 划分。 | 若未来技能边界需要每技能注解而非单一运行时快照，则以 `role: 'developer'` 迁移到 fragment。 |
| Workspace persona | 由 `system-prompt.section()` 拥有，因其作为系统提示中一个固定槽位出现。所有方已决定保持不变。 | 若 persona 覆盖想要运行时识别，则以 `role: 'user'` 与显式 `startMarker` 迁移到 fragment；系统提示路径仍对 persona 自身具权威性。 |
| Tool 运行时上下文 | 由 `systemPrompt.context()` 拥有，因其并入运行时快照。 | 若未来某工具需要 developer-role 注解（例如进行中的权限提醒），则迁移到 fragment；运行时上下文路径仍对静态工具指导具权威性。 |
| Agent-loop `model` 与 `cwd` 变量 | 由 `systemPrompt.variable()` 拥有，因它们是 section 文本里的 `{{variable}}` 插值，不是独立行。 | 变量不是 fragment；除非未来重写变量注册表，否则仍由 `systemPrompt.variable()` 管理。 |
## 已比较的替代方案

**复用 `ctx.systemPrompt.context()` 处理一切。** 否决：system prompt 运行时快照没有 marker、没有角色区分、没有识别协议；上文三个问题恰是 fragment 边界所解决的。在 `systemPrompt.context()` 上加 marker 与角色，会把 system prompt 运行时上下文与角色化 user/developer 内容混为一谈。

**复用 `agent-instructions` 作为通用 workspace-context 插件。** 否决：`agent-instructions` 是针对文件式工作区指令的专用插件，带专用的 `'agent-instructions'` 源种类，该种类持有类型化 `AgentInstructionChange[]` 行以支持 resume 调和。想要独立于文件式指令来对角色化 user/developer 内容定型的边界，需要自己的注册表与自己的源种类。

**不用共享注册表，各包自行实现识别。** 否决：每个贡献者都要重新推导自己的 marker 对与自己的转义，而且两个贡献者若选了相同的开闭字符串便彼此无法区分。共享注册表掌握 marker 命名空间与转义，识别才保持确定性。

**把该边界放进 `system-prompt/` 而非 `context/`。** 否决：该边界的契约是「向持久化日志贡献一段角色化、带 marker frame 的行」，而非「向 system prompt 装配贡献 section、context、变量」。与 `agent-instructions`、`session-reference`、`time-context` 同居的包，注册语义与同辈一致；把它放进 `system-prompt/` 会强制每个不贡献 system prompt 的贡献者也依赖 `system-prompt/`。

**把 marker 重新实现为 user 正文里的 XML 风格标签。** 否决：`agent-instructions` 既有的转义已证明反向：仓库内容中的字面 `</system-reminder>` 是已文档化的攻击面，共享转义是已文档化的唯一缓解。各贡献者重写一套转义是退化而非新特性。

**不做角色定型，全部留作 `user`。** 否决：Codex 的拆分有其道理：developer-role 内容（hook 附加上下文、未来的权限提醒）与 user-role 内容（工作区指令、时间戳）在权威性上有强弱之分。compaction、识别、Client 渲染都按角色分支；折叠角色拆分会使那些分支退回临时的名称检查。

## 验收标准

- `ctx.fragments.register(...)` 接受类型化 fragment，返回精确的 Cordis effect disposer，并在同层重名时抛错。
- `ctx.fragments.assemble(scope?)` 按 `order` 升序返回 `RenderedFragment[]`，对 body 应用 marker 转义，并按 `ctx.systemPrompt.context()` 的 scope 覆盖规则处理。
- `ctx.fragments.recognize(text)` 按 `order` 升序对每个 marker 包裹文本的已注册 fragment 返回一个 `FragmentMatch`，对未标记 fragment 或未标记输入返回 `[]`。
- `MessageSourceMap` 扩展在 `strict: true` 与 `noImplicitAny` 下编译通过，并保持可合并扩展，使未来包可加入各自的角色化种类而无需修改本文。
- 包级测试覆盖 marker 往返：body 含自身 start 或 end marker 的 fragment 在 invariant companion 处失败，错误消息点名 marker 与 fragment。
- 包级测试覆盖识别：`recognize('<system-reminder>body</system-reminder>')` 返回名为 `'agent-instructions'` 的一个匹配（在已注册前提下）；compaction 遮蔽原事件之后识别仍命中。
- 绑定测试证明：启用 `agent-instructions` 绑定后，字面 `<system-reminder>` frame 与 `</system-reminder>` 转义仍在渲染 baseline 中出现，且持久化源种类保持 `'agent-instructions'`。
- 绑定测试证明：禁用绑定后，agent-instructions baseline 不出现任何 fragment 渲染文本，包启动无可见回归。
- invariant companion 通过 `ctx.invariants.register('@deepseek-ai/dsh-context-fragments', ...)` 注册，注册表落定后运行；同层 marker 重复或 body 突破自身 frame 时在下一 `pre-step` 响亮失败。
- 共享 `ctx.fragments.escape(text, marker)` 算法与 `packages/context/agent-instructions/src/render.ts` 中既有的转义完全一致，因此提升后的实现不致破坏既有 agent-instructions 测试。
- 新包对其自身源文件通过 `pnpm run typecheck`、`pnpm run lint`、`pnpm run hygiene`、`pnpm run test`、`pnpm run test:coverage`；工作区 `pnpm run test` 继续通过。

## 风险

**贡献者之间的 marker 冲突。** 两个包若注册了相同的非空 start 或 end marker，便彼此无法识别。invariant companion 在注册时强制唯一，但配置错误的贡献者仍可能注册一个遮蔽系统级转义的 marker；识别协议的大小写不敏感匹配会扩宽命名空间，让意外冲突更易发生。缓解：注册表对 marker 含未来转义保留字符的贡献者记录 `warn` 级事件；同层重复由 invariant companion 响亮失败。

**Compaction 遮蔽 fragment 行。** Codex 模型依赖持久化的 marker 来识别 compaction 之后的先前注入。dsh 当前 compaction 保留源种类，但可能改写 body 内容；若改写丢失 fragment 的 marker，`recognize()` 失效。缓解：绑定 companion 将渲染文本存进持久化源的 `rendered` 字段；compacted 行 body 不再含已注册 marker 时由 invariant companion 响亮失败。

**两条表面外观相近。** 已调用 `ctx.systemPrompt.context()` 的贡献者可能误调 `ctx.fragments.register()`，反之亦然。缓解：每条表面的 README 显式对照两者；包测试每个文件只导入其中之一；`pnpm run duplication`（跨文件克隆检测）对同名同时注册两条表面的贡献者告警。

**持久化成本。** 每个渲染 fragment 是一条持久的 `user/message` 行，含类型化源种类、角色、名、order 与嵌入 `rendered` 数组。每步注册多个 fragment 的 session 比现有 system-prompt 运行时快照累积更快。缓解：出厂 `agent-loop` 的预算已对上下文做裁剪；`system-prompt/includeRuntimeContext` 不影响 fragment；绑定 companion 复用 `maxBytes`，对组装 body 应用同样的裁剪，成本与既有 agent-instructions 预算持平。

**共享转义在边界用例上退化。** `packages/context/agent-instructions/src/render.ts` 中的转义已用仓库路径与 budget marker 测试；转义助手共享后，更广的 body 语料（多行代码、大小写混合的闭标签、行边界的部分匹配）可能暴露新 bug。缓解：包测试提供的语料库复刻既有 agent-instructions 转义测试，并加入多行代码块、大小写混合闭标签、行边界部分匹配，必须无回归往返。

**与 `system-prompt` 的 scope 覆盖规则漂移。** `ctx.fragments.assemble(scope?)` 沿用 `ctx.systemPrompt.context()` 的 scope 规则；若未来 system-prompt 的 scope 规则变更（例如新增祖先唯一覆盖策略）却未同步到此处，两条表面会漂移。缓解：注册表的 scope 助手直接复用 `@deepseek-ai/dsh-scope` 中 `system-prompt/` 共享的 `ScopedLayers`；回归测试断言 `assemble(undefined)` 与 `assemble(scopeKey)` 在相同注册下产生与 `systemPrompt.assemble` 一致的覆盖行为。

本文沿用既有 `system-prompt/`、`agent-instructions`、`MessageSourceMap` 边界，不取代其中任何一项。`system-prompt` 注册表对 section、context、tool、variable 仍具权威性。`agent-instructions` 源种类对工作区指令与 resume 调和仍具权威性。`MessageSourceMap` 扩展落在独立 `.d.ts`，并可合并扩展；既有源种类形状不变。plugin-candidates 笔记、刷新镜像笔记与 [plugin-roles 提案](2026-08-26-dsh-collaboration-presets.zh.md) 仍各自负责自身表面，仅需据实更新排序，无需归档。
