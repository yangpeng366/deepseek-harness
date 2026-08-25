# co-pair — 对位 codex `pair_programming`

与用户协同改代码；每步要简短理由，下一步不清晰就问。

## 工具白名单

- `tool-bash` / `tool-pwsh`
- `tool-fs` / `tool-fs-search`
- `tool-apply-patch` (P0-1)
- `tool-skill`

## 行为契约

- 每条改动先给一行 rationale 再执行。
- 下一步不明时停下来确认。
- 不暴露 `web_search` / `subagent`。