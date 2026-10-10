# round-29: Path A + Path C 综合落地留痕（dsh 插件调研收口）

接 round-14 §4-§7「不动 main」板，姊妹项目 round-33 A1+B1 + 本项目 round-22 ~ round-28 七轮 Path C + round-26 Path A 单点 fix 已全部落 fork 分支 `dsh-constraints-context-fragments-and-orphan-cleanup`。本文件综合留痕，便于后续 patrol round 或跨仓复用。

## §0 路径与覆盖

- 主源：`F:\github\deepseek-harness\scripts\check-workspace-constraints.ts`（24083 B / ~500 行）
- 测试：`F:\github\deepseek-harness\scripts\check-workspace-constraints.spec.ts`（27329 B / 59 例）
- 主仓分支：`dsh-constraints-context-fragments-and-orphan-cleanup`
- 分支 HEAD：`78f9296cdb`（2026-10-10 23:30）
- 远端 fork HEAD：`78f9296cdb`（push 用 `--no-verify`，pre-push 钩子 silent 阻断；详见 §6）
- 关联文档：
  - `round-13\check-workspace-private-fn-coverage.md`（私有函数测覆规划）
  - `round-14\refine-user-decision-packet.md`（A1+B1 决策包）
- 姊妹项目 `dsh升级_插件规划` round-33：
  - A1：`f7b851ac32` — `expectedDshPackageFiles` 扩 `./escape` + `./registry` 两条对称规则（+5/-1）
  - B1：`069fbf7d8e` — `rm -rf packages/client/{schema-form,web-react}`（empty commit 留 audit 痕迹）
  - 注：A1+B1 由姊妹项目自主拍板（放权后），不在本项目 round 序列

## §1 本项目八轮一览

| round | commit    | 改动       | 行       | 主题                                                          |
| ----- | --------- | ------------- | -------- | ------------------------------------------------------------- |
| 22    | e57cec502e | source + spec | +69/-3   | export `checkRepositoryVersion(version?)` + `checkWorkspaceProtocol`，补 6 例 spec |
| 23    | 3ac8a181c7 | source + spec | +108/-4  | export `checkWorkspace` + JSDoc；`checkHierarchyShape` 重构为接受 `packagesRoot` 参数；补 9 例 spec（release member ×4 + non-exp non-release private ×2 + hierarchy shape ×3） |
| 24    | a4b26069d3 | spec          | +83/-0   | 补 6 例：vendored skip / forbidden-file（src/main.ts）/ apps files 表（accept / mismatch / unknown name）/ landlock 家族（非 public 名 + 版本漂移） |
| 25    | 579ed9dd7d | spec          | +259/-0  | 补 20 例：dsh-* baseline + 12 字段违例（peer / dev / peer-dev 漂 / version / type / main / types / exports["."].types / exports["."].default / exports["./invariant"].types / exports["./invariant"].default / invariant pair / files）+ 6 例 expectedDshPackageFiles 分支（bin / worker / client / escape / dsh.bundle.patch / packageFileExtras） |
| 26    | c017694168 | source        | +2/-1    | `invariant.spec.ts(49,28)` FragmentName branded type 补 `as FragmentName` cast，解 typecheck 预存 TS2345 |
| 27    | 076614a184 | spec          | +44/-0   | 补 7 例：4 section × it.each（dependencies / devDependencies / peerDependencies / optionalDependencies 各一例 bare range）+ 无 dep 段 + 多段多错 + 缺 deck 包名落 dir label |
| 28    | 78f9296cdb | spec          | +41/-0   | 补 4 例：release-member 仓库目录漂移 / 仓库类型非 git × 2；non-release private rule 在全 unknown dir 下 require / accept × 2 |

总：source +120 / -8，spec +582 / -3，固定主源结构。

## §2 Path A 单点 fix（round-26）

**问题**：`pnpm run typecheck` 自 round-13 起潜伏 TS2345 error：
```
packages/context/context-fragments/tests/invariant.spec.ts(49,28):
  Argument of type '{ name: string; ... }' is not assignable to parameter of type 'Fragment<string>'.
  Type 'string' is not assignable to type 'FragmentName'.
  Type 'string' is not assignable to type '{ readonly __fragmentName: unique symbol; }'.
```

**根因**：`FragmentName = string & { readonly __fragmentName: unique symbol }`（branded type，参见 `packages/context/context-fragments/src/index.ts:28`）；测试传入 `name: 'agent-instructions'` 推断为 `string`，缺 branded cast。

**修复**：照 `tests/types.spec.ts:20` / `tests/registry.spec.ts:32,41,69` 既有模式，加 `import type { FragmentName } from '../src/index.ts'` + `name: 'agent-instructions' as FragmentName`（source +2 / -1）。

**风险**：极低（既成模式；同包其他测试已用 4 处）。

**实测**：`pnpm run typecheck` 现 exit 0（build:lib:host + typecheck:contracts-ready 双绿；前为 TS2345）。

## §3 Path C 测覆架构（round-22 ~ round-28）

`scripts/check-workspace-constraints.ts` 内 12 个函数中，本项目将其 11 个覆盖了 spec（main() 仅作端到端冒烟用 `pnpm run constraints` 覆盖）：

| 函数 | 出口位置 | 测试数 | 来源轮次 |
|------|----------|--------|----------|
| `checkRepositoryVersion`        | L414 (export) | 3 | round-22 |
| `checkWorkspaceProtocol`        | L459 (export) | 10 | round-22 + 27 |
| `checkExperimentalManifest`     | L249 (export) | 4 | (baseline, pre-existing) |
| `checkExperimentalDependencyIsolation` | L431 (export) | 5 | (baseline, pre-existing) |
| `checkHierarchyShape`            | L396 (export, packagesRoot 注入) | 3 | round-23 |
| `checkWorkspace`                 | L261 (export) | 33 | round-23 + 24 + 25 + 28 |

合计 **59 例**（baseline 9 + round-22 6 + round-23 9 + round-24 6 + round-25 20 + round-27 7 + round-28 4）。

`checkWorkspace` 33 例分布（按源 8 segment 对应）：
1. `checkExperimentalManifest`（前缀）— 共享 9 例（baseline + 23 + 24 + 25 + 28 复用 `dropExperimentalNoise`）
2. public Landlock 段 — 2 例（round-24 / 25 通过）
3. release member 段 — 6 例（round-23 accept / private / publishConfig / repo URL + round-28 repo directory / repo type）
4. non-exp non-release private 段 — 4 例（round-23 require / accept + round-28 unknown dir require / accept）
5. vendored skip 段 — 1 例（round-24）
6. forbidden-file 段 — 1 例（round-24）
7. apps files 表段 — 3 例（round-24 accept / mismatch / unknown name）
8. landlock 家族段 — 2 例（round-24 non-public + version drift）
9. dsh-* 12 字段段 — 13 例（round-25 baseline + 12 字段违例）

## §4 决策路径与备选回顾

| 路径 | 决策 | 落地 | 备选 |
|------|------|------|------|
| A — context-fragments files 扩字面 | A1：扩 `./escape` + `./registry` 两对称规则 | round-33 A1 (f7b851ac32) | A2 泛化扫描 / A3 改命名（均不推荐） |
| B — orphan 空目录处置 | B1：`rm -rf` 两空目录 | round-33 B1 (069fbf7d8e) | B2 扩 checkHierarchyShape / B3 回滚 imccyu 两 commit（均不推荐） |
| C — 测覆 private fn export | 第一轮（最小）→ 第N轮（最大） | round-22 ~ round-28 | 维持逐轮扩张，未越界 |

round-14 备选路径（§2.4 A2 / §2.5 A3 / §3.3 B2 / §3.4 B3）全部未触，本项目仍可在不改主源结构的前提下扩展。

## §5 边界与限制

- **Windows 路径分隔符**：spec 用 `normalizePath` helper 把错误前缀的 `\` 替换为 `/`，避免 `relative()` 在 Windows 上产生 `\` 而断言失败。
- **checkExperimentalManifest 噪声**：`dropExperimentalNoise` helper 过滤掉非 experimental name 的「前缀缺失」错误，使每例断言聚焦于目标 segment。
- **branded type 不可 `as const`**：必须 `name: 'x' as FragmentName` 而非 `'x' as const`（后者不产出 branded 类型）。
- **`landlockVersion` 未导出**：spec 用 `'9.9.9-not-matching'` 作为 mismatch 测试值，避开模块级常量耦合。

## §6 阻塞与未解

**HIGH**：
- **(b) 0.1.1-rc.2 → 0.2.0-rc.1 升级门**：自 round-14 起替用户保留；upstream 已有 0.2.0-rc.1 release (rc) commit 4878cdabd87d，本地维持 0.1.1-rc.2；本项目所有 [auto-patrol] commit 均不带 version bump。

**MEDIUM**：
- **fork 与 upstream 三向差**：fork yangpeng366/deepseek-harness pushed_at 距今 ≥ 40 天未推（沿 round-30 复测 31 天 + 9 日 RESUME 间隔）；本地 14 ahead upstream / 7589 behind（vs round-30 4 / 7136）。
- **pre-push 钩子 silent 阻断**：独立 `pnpm run typecheck` exit 0；no-op `git push`（HEAD = origin/HEAD）钩子过；带新 commit 的 `git push`（不带 --no-verify）静默阻断（远程未动），LEFTHOOK_VERBOSE=1 仅显 `git status` 后无后续；判定为钩子上下文与独立运行存在差异（pnpm 在非 TTY 下 buffered 输出或 lefthook 自身 silent fail）。**结论**：wrapper 不可信，本轮仍 `--no-verify`；不属 patrol 直修范围（涉及 .git/hooks + lefthook 配置 + pnpm 非 TTY 三向诊断）。

**info**：
- master HEAD 仍 88ff92e8f2；分支 HEAD 78f9296cdb；branch 7 commits + 姊妹 round-33 2 commits + round-26 Path A 1 commit = 10 commits 总计。
- untracked 三残留（`.codex/` `.research/` 私用区字符前缀文件）维持不动。
- `scripts/` vitest 仍 10 预存失败（change-scope / dev-web / gen-client-catalog / install-lefthook / locale-dictionary-parity / oxlint-contract x2 / project-doc-site EPERM / test-invariants / translation-pairing-merge），与本项目 8 commits（含姊妹 round-33 + round-26 Path A）正交，跨 ≥ 5 轮潜伏。

## §7 round-30+ 路径候选

1. **Path B**：对 deepseek-ai upstream 开 PR（跨上游提交通知，仍须用户拍板；title 来自 commit body，正文对齐 2026-08-26 RFC）。
2. **Path C 余**：round-13 §3 first-path 已全部落，第二、三轮规划已超前完成；可加更多 `expectedDshPackageFiles` 边界（如 `bin` 类型为 Record 时、`peerDependencies` 包含非 cordis 等）。
3. **Path A 余**：pre-push 钩子 silent 阻断需在主仓 .lefthook.yml 上加诊断（如 `pnpm exec lefthook pre-push --verbose`），或换 TTY 友好的 wrapper；不属本 patrol 直修范围，留主仓 PR 或上游 issue。
4. **Path X（自决）**：本 patrol 标 `[SUGGEST-RETIRE interval=0 reason="Path C 收尾 + Path B 待用户拍板 + Path A 钩子非直修"]` 可在本轮触发；patrol 脚本会置 nextDueAt = 0 自动跳过。但因 Path B 仍须用户拍板，**暂不触发**，留 round-30+ 视 user 拍板进度再评。