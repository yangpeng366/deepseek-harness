# @deepseek-ai/dsh-context-fragments

[English](README.md) | 中文

跨 `packages/context/` 各贡献者共享的类型化请求上下文片段：角色感知的 `Fragment<Body>` 模型、注册表拥有的 marker 对、内容盲转义使不受信任的 body 文本无法关闭插件拥有的 frame，以及一个从持久化 marker 重新识别先前注入的识别辅助函数。

第 1 步交付本包、类型与共享转义。`ctx.fragments.register` 与 `ctx.fragments.assemble` 在第 2 步交付；`MessageSourceMap` 的声明合并扩展在第 3 步完成；让 agent-instructions binding 退役重复转义的实现在第 4 步交付。决策记录：[dsh context-fragments seam Agent Note](../../../.agents/notes/proposed/feature/2026-09-03-dsh-context-fragments.zh.md) 与 [四步分解](../../../.agents/notes/proposed/feature/2026-09-04-dsh-context-fragments-implementation-steps.zh.md)。

## 本包当前拥有

- `Fragment<Body>` 贡献模型，含 `role`、`startMarker`、`endMarker`、`order`、`body`。
- `escapeFrameBody(body, marker)` —— 所有贡献者与未来 binding 共享的规范转义。
- `RenderedFragment` 与 `FragmentMatch` 值类型。
- `escapeInstructionFrameBody(body)` —— 在第 4 步退役重复实现前，与 agent-instructions 字节级一致的辅助函数。

## 本包当前不拥有

- Cordis 插件注册、生命周期监听器或 `apply()`。
- `MessageSourceMap` 的消费者。`packages/llm/llm/src/context-fragments.d.ts` 中的合并存根仅为标记注释。
- scope 辅助函数、snapshot 装配或持久化发射。
