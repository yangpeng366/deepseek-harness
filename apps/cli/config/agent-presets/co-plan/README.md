# co-plan — 对位 codex `plan`

只产出计划与可行性分析，禁止修改工作树。

## 工具白名单

- `tool-fs` (readOnly)
- `tool-fs-search`
- `tool-skill`

## 行为契约

- 先产出书面计划；等待用户显式确认才允许落到 `co-execute`。
- 不暴露 `shell` / `write` / `apply-patch` / `subagent`。