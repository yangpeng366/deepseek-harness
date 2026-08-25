# co-default — 对位 codex `default`

只读 + 工具最少的默认协作模式。任务起点切换；session 内不二次切换。

## 工具白名单

- `tool-fs` (readOnly)
- `tool-fs-search`
- `tool-skill`

## 行为契约

- 先读后答。
- 不暴露 `shell` / `write` / `apply-patch` / `subagent`。
- 一旦发现需要修改工作树，立即切到 `co-execute` / `co-pair`。