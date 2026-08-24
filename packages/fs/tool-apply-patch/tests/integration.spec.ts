/**
 * Keyless integration tests for @deepseek-ai/dsh-tool-apply-patch.
 *
 * Mirrors select scenarios from `codex-rs/apply-patch/tests/suite/scenarios.rs`
 * using an in-process `NodeFsBackend` (real `node:fs/promises` writes into a
 * per-test temp directory) and the public `applyPatch` entry point from
 * `apply-core.ts`. Fixture bodies are inlined so this file stays portable
 * across machines; the upstream scenario fixtures live at
 * `codex-rs/apply-patch/tests/fixtures/scenarios/` and are byte-for-byte the
 * source of truth that this file re-encodes.
 *
 * Run with: `tsx tests/integration.spec.ts` (no vitest install required).
 *
 * Each scenario gets its own `os.tmpdir()` subdirectory so the suite leaves
 * nothing behind. The suite is hermetic: no network, no DEEPSEEK_API_KEY, no
 * Cordis imports, no dsh-runtime dependencies.
 *
 * @module @deepseek-ai/dsh-tool-apply-patch/tests/integration
 */

import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, sep, relative } from "node:path"

import {
  applyPatch,
  ApplyPatchParseError,
} from "../src/apply-core.ts"
import type { PatchFileBackend } from "../src/apply-core.ts"

/**
 * Real-filesystem `PatchFileBackend`. Paths are resolved relative to the
 * caller-supplied `root`; this is the adapter the live `apply.ts` builds
 * from `ctx.fs`, but with no Cordis dependency so the test harness stays
 * portable. `delete` always succeeds (calls `fs.unlink`), which is the
 * codex semantics the live adapter falls back to via `ctx.shell` when a
 * shell capability is mounted.
 */
function makeNodeFsBackend(root: string): PatchFileBackend {
  const safeJoin = (rel: string): string => {
    const normalised = rel.split("/").join(sep)
    const target = join(root, normalised)
    const relBack = relative(root, target)
    if (relBack.startsWith("..") || target === root) {
      throw new Error(`Refusing to touch path outside workdir: ${rel}`)
    }
    return target
  }
  return {
    async resolve(path: string): Promise<{ displayPath: string }> {
      const looksAbsolute =
        path === root ||
        path.startsWith(root + sep) ||
        path.includes(":" + sep) ||
        path.startsWith(sep)
      const display = looksAbsolute ? path : safeJoin(path)
      return { displayPath: relative(root, display) || display }
    },
    async read(path: string): Promise<string | null> {
      try {
        return await fs.readFile(safeJoin(path), "utf8")
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
        throw err
      }
    },
    async write(
      path: string,
      content: string,
      options: { createIfAbsent: boolean },
    ): Promise<{
      operation: "create" | "update"
      before: string | null
      after: string
    }> {
      const target = safeJoin(path)
      let before: string | null = null
      try {
        before = await fs.readFile(target, "utf8")
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      }
      if (options.createIfAbsent && before !== null) {
        throw new Error(`Refusing to overwrite existing file: ${path}`)
      }
      await fs.mkdir(join(target, ".."), { recursive: true })
      await fs.writeFile(target, content, "utf8")
      const op: "create" | "update" = before === null ? "create" : "update"
      return { operation: op, before, after: content }
    },
    async delete(path: string): Promise<{ before: string }> {
      const target = safeJoin(path)
      const before = await fs.readFile(target, "utf8")
      await fs.unlink(target)
      return { before }
    },
  }
}

interface Scenario {
  name: string
  inputs: Record<string, string>
  patch: string
  mode?: "strict" | "lenient"
  expect: Record<string, string | null>
  expectApplied: number
  expectFailed?: number
}

interface ScenarioResult {
  ok: boolean
  message?: string
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const root = await mkdtemp(join(tmpdir(), `dsh-apply-patch-int-`))
  try {
    for (const [rel, body] of Object.entries(scenario.inputs)) {
      const target = join(root, rel.split("/").join(sep))
      await fs.mkdir(join(target, ".."), { recursive: true })
      await fs.writeFile(target, body, "utf8")
    }
    const backend = makeNodeFsBackend(root)
    if (scenario.expectParseError === true) {
      await assert.rejects(
        () => applyPatch(scenario.patch, backend, scenario.mode ?? "strict"),
        ApplyPatchParseError,
      )
      return { ok: true }
    }
    const result = await applyPatch(
      scenario.patch,
      backend,
      scenario.mode ?? "strict",
    )
    if (result.applied !== scenario.expectApplied) {
      return {
        ok: false,
        message: `applied=${result.applied} expected=${scenario.expectApplied}`,
      }
    }
    if (scenario.expectFailed !== undefined && result.failed !== scenario.expectFailed) {
      return {
        ok: false,
        message: `failed=${result.failed} expected=${scenario.expectFailed}`,
      }
    }
    const actual = await snapshotDir(root)
    const want: Record<string, string | null> = {}
    for (const [rel, body] of Object.entries(scenario.expect)) {
      const norm = rel.split("/").join("/"); want[norm] = body === null ? null : body
    }
    for (const norm of Object.keys(actual)) {
      if (!(norm in want)) {
        return { ok: false, message: `unexpected file left behind: ${norm}` }
      }
    }
    for (const [norm, expected] of Object.entries(want)) {
      if (expected === null) {
        if (norm in actual) {
          return { ok: false, message: `expected ${norm} to be deleted but it still exists` }
        }
        continue
      }
      if (!(norm in actual)) {
        return { ok: false, message: `expected ${norm} to exist but it does not` }
      }
      if (actual[norm] !== expected) {
        return {
          ok: false,
          message: `file ${norm} content mismatch\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual[norm])}`,
        }
      }
    }
    return { ok: true }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function snapshotDir(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const norm = relative(root, full).split(sep).join("/")
        out[norm] = await fs.readFile(full, "utf8")
      }
    }
  }
  await walk(root)
  return out
}

const SCENARIOS: Scenario[] = [
  {
    name: "001_add_file: bare create succeeds and only bar.md exists after",
    inputs: {},
    patch: "*** Begin Patch\n*** Add File: bar.md\n+This is a new file\n*** End Patch\n",
    expectApplied: 1,
    expect: { "bar.md": "This is a new file" },
  },
  {
    name: "003_multiple_chunks: two updates on one file in order",
    inputs: {
      "multi.txt": "line1\nline2\nline3\nline4\n",
    },
    patch:
      "*** Begin Patch\n" +
      "*** Update File: multi.txt\n" +
      "@@\n" +
      "-line2\n" +
      "+changed2\n" +
      "@@\n" +
      "-line4\n" +
      "+changed4\n" +
      "*** End Patch\n",
    expectApplied: 1,
    expect: {
      "multi.txt": "line1\nchanged2\nline3\nchanged4\n",
    },
  },
  {
    name: "004_move_to_new_directory: move honours siblings",
    inputs: {
      "old/name.txt": "old content\n",
      "old/other.txt": "unrelated file\n",
    },
    patch:
      "*** Begin Patch\n" +
      "*** Update File: old/name.txt\n" +
      "*** Move to: renamed/dir/name.txt\n" +
      "@@\n" +
      "-old content\n" +
      "+new content\n" +
      "*** End Patch\n",
    expectApplied: 1,
    expect: {
      "old/name.txt": null,
      "old/other.txt": "unrelated file\n",
      "renamed/dir/name.txt": "new content\n",
    },
  },
  {
    name: "020_delete_file_success: deletes only obsolete.txt, keep.txt survives",
    inputs: {
      "keep.txt": "keep\n",
      "obsolete.txt": "obsolete\n",
    },
    patch: "*** Begin Patch\n*** Delete File: obsolete.txt\n*** End Patch\n",
    expectApplied: 1,
    expect: {
      "keep.txt": "keep\n",
      "obsolete.txt": null,
    },
  },
  {
    name: "Mixed Add + Update + Delete against real fs (round 3 mixed scenario)",
    inputs: {
      "u.txt": "alpha\nbeta\n",
      "delete.txt": "to be removed\n",
    },
    patch:
      "*** Begin Patch\n" +
      "*** Add File: nested/new.txt\n" +
      "+created\n" +
      "*** Delete File: delete.txt\n" +
      "*** Update File: u.txt\n" +
      "@@\n" +
      "-alpha\n" +
      "+ALPHA\n" +
      "*** End Patch\n",
    expectApplied: 3,
    expect: {
      "nested/new.txt": "created",
      "delete.txt": null,
      "u.txt": "ALPHA\nbeta\n",
    },
  },
  {
    name: "Parse error: ApplyPatchParseError before any I/O (no fs writes occur) [expect rejection]",
    inputs: {},
    patch: "this is not a patch",
    expectApplied: 0,
    expectFailed: 0,
    expectParseError: true,
    expect: {},
  },
]

interface Case {
  name: string
  run: () => Promise<void>
}

const cases: Case[] = []

for (const scenario of SCENARIOS) {
  cases.push({
    name: scenario.name,
    async run() {
      const res = await runScenario(scenario)
      assert.equal(
        res.ok,
        true,
        res.message ?? `scenario ${scenario.name} failed without message`,
      )
    },
  })
}

cases.push({
  name: "NodeFsBackend: refuses to escape the workdir via ../",
  async run() {
    const root = await mkdtemp(join(tmpdir(), `dsh-apply-patch-int-`))
    try {
      const backend = makeNodeFsBackend(root)
      await assert.rejects(
        () => backend.write("../escape.txt", "evil", { createIfAbsent: true }),
        /Refusing to touch path outside workdir/,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
})

cases.push({
  name: "NodeFsBackend: read returns null for missing file, not throws",
  async run() {
    const root = await mkdtemp(join(tmpdir(), `dsh-apply-patch-int-`))
    try {
      const backend = makeNodeFsBackend(root)
      const result = await backend.read("does-not-exist.txt")
      assert.equal(result, null)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
})

cases.push({
  name: "NodeFsBackend: delete throws on missing target",
  async run() {
    const root = await mkdtemp(join(tmpdir(), `dsh-apply-patch-int-`))
    try {
      const backend = makeNodeFsBackend(root)
      await assert.rejects(
        () => backend.delete("does-not-exist.txt"),
        (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT",
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
})

let passed = 0
let failed = 0
for (const tc of cases) {
  try {
    await tc.run()
    console.log(`ok  ${tc.name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL ${tc.name}: ${(err as Error).message}`)
    failed += 1
  }
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
