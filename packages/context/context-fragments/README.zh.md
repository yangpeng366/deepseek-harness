# `@deepseek-ai/dsh-context-fragments`

[English](README.md) | 中文

类型化的请求上下文片段：共享的标记转义、角色感知的正文，以及 Cordis
驱动的注册表，统一持有按作用域的注册、分层装配，以及对历史注入片段
的、内容无感的识别。

本包是
[`dsh-context-fragments`](../../../../.agents/notes/proposed/feature/2026-09-03-dsh-context-fragments.md)
缝的注册表侧实现。四步实施计划的 Step 1 与 Step 2 在此落地；持久化
source kind、绑定伴随器以及 spine 快照见 Step 3 与 Step 4。

## 接口

```ts
import { apply, FragmentsService, escapeFrameBody } from '@deepseek-ai/dsh-context-fragments'

const ctx = new Context()
apply(ctx, { defaultRole: 'user' })

ctx.fragments.register({
  name: 'agent-instructions' as FragmentName,
  role: 'developer',
  startMarker: '<system-reminder>',
  endMarker: '</system-reminder>',
  order: 0,
  body: 'remember to be helpful',
})

const ordered = await ctx.fragments.assemble()
const rendered = ctx.fragments.render(ordered[0])
const matches = ctx.fragments.recognize(rendered.text)
```

服务持有跨作用域链的合并装配；同 `name` 的作用域级片段覆盖全局片段，
同层的重名与标记对冲突在 `register` 阶段即抛出。`./invariant` 中的
伴随器捕获单层插入检查看不到的跨层问题。

## 作用域规则

片段沿用 `system-prompt` 的作用域规则：全局贡献 + 作用域键覆盖、最
近作用域胜出，`register` 返回 Cordis 效应的精确 disposer。已释放的
片段不会在层中残留；装配瀑布看到的是当前活跃集合。

## 识别

`recognize(text, scope?)` 在文本中按字面子串扫描当前作用域链中每个
注册片段的 `startMarker` + `endMarker`。每个片段至多贡献一次匹配；
重叠候选项按注册顺序上报，保证结果确定性。

## 不在范围（Step 3 / Step 4）

- `MessageSourceMap` 上的持久化 source kind，使 agent-loop 能为每个
  注册片段落盘一条 `user/message`。
- 把 `ctx.fragments.register` 接入已发布的 agent-instructions 贡献者，
  且不改动其渲染输出的字节内容的绑定伴随器。
- 锁定装配、渲染基线的快照测试。

## 配置

`apply(ctx, config)` 接受可选的 `defaultRole`（`'developer' | 'user'`，默认
`'user'`）。兜底角色通过 `ctx.fragments.resolveDefaultRole()` 暴露，
贡献者可无需在每个片段上重复声明。