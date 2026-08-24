/** Keyless apply-core unit tests for @deepseek-ai/dsh-tool-apply-patch.
 *  Run with: `tsx tests/apply-core.spec.ts` (no vitest install required).
 *  Mirrors select assertions from codex-rs/apply-patch/src/lib.rs apply_hunks.
 */

import { strict as assert } from "node:assert"
import {
  AddFileConflictError,
  ApplyPatchParseError,
  DeleteNotSupportedError,
  FileNotFoundError,
  HunkNotAppliedError,
  MoveSourceCleanupError,
  applyPatch,
  applyPatchFromArgs,
  computeUpdatedContent,
} from "../src/apply-core.ts"
import type { HunkOutcome, PatchFileBackend } from "../src/apply-core.ts"

/** In-memory backend stub. The dsh `ctx.fs` seam does not expose delete, so the default adapter throws DeleteNotSupportedError; tests that need delete mount a small `withDelete` wrapper. */
class MemBackend implements PatchFileBackend {
  files = new Map<string, string>()

  async resolve(path: string): Promise<{ displayPath: string }> {
    return { displayPath: path }
  }

  async read(path: string): Promise<string | null> {
    return this.files.has(path) ? (this.files.get(path) as string) : null
  }

  async write(
    path: string,
    content: string,
    options: { createIfAbsent: boolean },
  ): Promise<{ operation: "create" | "update"; before: string | null; after: string }> {
    const before = this.files.has(path) ? (this.files.get(path) as string) : null
    if (options.createIfAbsent && before !== null) {
      throw new AddFileConflictError(path)
    }
    this.files.set(path, content)
    return { operation: before === null ? "create" : "update", before, after: content }
  }

  async delete(path: string): Promise<{ before: string }> {
    throw new DeleteNotSupportedError()
  }
}

/** Convenience wrapper that implements delete by removing from the map. */
function withDelete(b: MemBackend): PatchFileBackend & { files: Map<string, string> } {
  return {
    files: b.files,
    resolve: (path) => b.resolve(path),
    read: (path) => b.read(path),
    write: (path, content, options) => b.write(path, content, options),
    async delete(path: string): Promise<{ before: string }> {
      const before = b.files.get(path)
      if (before === undefined) {
        throw new FileNotFoundError(path)
      }
      b.files.delete(path)
      return { before }
    },
  }
}

interface TestCase {
  name: string
  run: () => Promise<void>
}

const cases: TestCase[] = []

// ----- AddFile -------------------------------------------------------------

cases.push({
  name: "AddFile: creates a new file with the parsed content",
  async run() {
    const backend = new MemBackend()
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Add File: hello.txt",
        "+Hello world",
        "+Line two",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(result.failed, 0)
    assert.equal(backend.files.get("hello.txt"), "Hello world\nLine two")
    assert.equal(result.summary, "Added 1 file (hello.txt)")
  },
})

cases.push({
  name: "AddFile: refuses to overwrite an existing file",
  async run() {
    const backend = new MemBackend()
    backend.files.set("dup.txt", "original\n")
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Add File: dup.txt",
          "+new content",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
    // The original content is untouched.
    assert.equal(backend.files.get("dup.txt"), "original\n")
  },
})

// ----- UpdateFile ----------------------------------------------------------

cases.push({
  name: "UpdateFile: replaces lines via the fuzzy locator (exact pass)",
  async run() {
    const backend = new MemBackend()
    backend.files.set(
      "greet.py",
      "def greet():\n    print('Hi')\n    return 0\n",
    )
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: greet.py",
        "@@ def greet():",
        "-    print('Hi')",
        "+    print('Hello')",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(result.failed, 0)
    assert.equal(
      backend.files.get("greet.py"),
      "def greet():\n    print('Hello')\n    return 0\n",
    )
  },
})

cases.push({
  name: "UpdateFile: multi-chunk patch applies hunks sequentially",
  async run() {
    const backend = new MemBackend()
    backend.files.set(
      "multi.ts",
      ["line1", "line2", "line3", "line4", "line5"].join("\n") + "\n",
    )
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: multi.ts",
        "@@",
        "-line1",
        "+LINE1",
        "@@",
        "-line4",
        "+LINE4",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(
      backend.files.get("multi.ts"),
      ["LINE1", "line2", "line3", "LINE4", "line5"].join("\n") + "\n",
    )
  },
})

cases.push({
  name: "UpdateFile: trailing-newline is preserved on round-trip",
  async run() {
    const backend = new MemBackend()
    backend.files.set("noeof.txt", "alpha\nbeta\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: noeof.txt",
        "@@",
        "-beta",
        "+BETA",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(backend.files.get("noeof.txt"), "alpha\nBETA\n")
  },
})

cases.push({
  name: "UpdateFile: trailing-newline is added when source had none",
  async run() {
    const backend = new MemBackend()
    backend.files.set("noeof.txt", "alpha\nbeta") // no trailing newline
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: noeof.txt",
        "@@",
        "-beta",
        "+BETA",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    // Source had no trailing newline; output should mirror that.
    assert.equal(backend.files.get("noeof.txt"), "alpha\nBETA")
  },
})

cases.push({
  name: "UpdateFile: HunkNotAppliedError when oldLines cannot be located",
  async run() {
    const backend = new MemBackend()
    backend.files.set("missing.txt", "alpha\nbeta\n")
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Update File: missing.txt",
          "@@",
          "-not-in-file",
          "+BETA",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
  },
})

cases.push({
  name: "UpdateFile: FileNotFoundError when target does not exist",
  async run() {
    const backend = new MemBackend()
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Update File: absent.txt",
          "@@",
          "-x",
          "+y",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
  },
})

cases.push({
  name: "UpdateFile with Move to: writes to new path; source cleanup via withDelete succeeds",
  async run() {
    const backend = withDelete(new MemBackend())
    backend.files.set("old/path.py", "alpha\nbeta\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: old/path.py",
        "*** Move to: new/path.py",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(backend.files.get("new/path.py"), "ALPHA\nbeta\n")
    assert.equal(backend.files.has("old/path.py"), false)
    // Summary mentions the destination path (not the source).
    assert.ok(result.summary.includes("new/path.py"))
  },
})

cases.push({
  name: "UpdateFile with Move to: MoveSourceCleanupError when delete is unsupported",
  async run() {
    const backend = new MemBackend() // delete throws DeleteNotSupportedError
    backend.files.set("old.py", "alpha\nbeta\n")
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Update File: old.py",
          "*** Move to: new.py",
          "@@",
          "-alpha",
          "+ALPHA",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
    // Destination still got the new content despite the cleanup error.
    assert.equal(backend.files.get("new.py"), "ALPHA\nbeta\n")
    // Source remains because delete failed.
    assert.equal(backend.files.get("old.py"), "alpha\nbeta\n")
  },
})

// ----- DeleteFile ----------------------------------------------------------

cases.push({
  name: "DeleteFile: withDelete removes the file and reports before",
  async run() {
    const backend = withDelete(new MemBackend())
    backend.files.set("gone.txt", "delete me\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Delete File: gone.txt",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(backend.files.has("gone.txt"), false)
    assert.ok(result.summary.includes("Deleted 1 file"))
  },
})

cases.push({
  name: "DeleteFile: bare backend raises DeleteNotSupportedError",
  async run() {
    const backend = new MemBackend()
    backend.files.set("x.txt", "x\n")
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Delete File: x.txt",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
  },
})

cases.push({
  name: "DeleteFile: FileNotFoundError when target does not exist",
  async run() {
    const backend = withDelete(new MemBackend())
    const result = await applyPatch(
        [
          "*** Begin Patch",
          "*** Delete File: never-existed.txt",
          "*** End Patch",
        ].join("\n"),
        backend,
        "strict",
      )
    assert.equal(result.applied, 0)
    assert.equal(result.failed, 1)
  },
})

// ----- Mixed patches + stop-on-first-failure -------------------------------

cases.push({
  name: "Mixed patch (Add + Update + Delete): all three succeed in order",
  async run() {
    const backend = withDelete(new MemBackend())
    backend.files.set("u.txt", "alpha\nbeta\n")
    backend.files.set("d.txt", "x\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Add File: a.txt",
        "+aaa",
        "*** Update File: u.txt",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** Delete File: d.txt",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 3)
    assert.equal(result.failed, 0)
    assert.equal(backend.files.get("a.txt"), "aaa")
    assert.equal(backend.files.get("u.txt"), "ALPHA\nbeta\n")
    assert.equal(backend.files.has("d.txt"), false)
    assert.ok(result.summary.includes("Added 1 file"))
    assert.ok(result.summary.includes("Updated 1 file"))
    assert.ok(result.summary.includes("Deleted 1 file"))
  },
})

cases.push({
  name: "Mixed patch: stop at first failure, prior mutations persist",
  async run() {
    const backend = withDelete(new MemBackend())
    backend.files.set("u.txt", "alpha\nbeta\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Add File: a.txt",
        "+aaa",
        "*** Delete File: never.txt",
        "*** Update File: u.txt",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(result.failed, 1)
    assert.equal(backend.files.get("a.txt"), "aaa")
    // The Update hunk did NOT run; u.txt is untouched.
    assert.equal(backend.files.get("u.txt"), "alpha\nbeta\n")
    assert.equal(result.hunks.length, 2)
    const failed = result.hunks[1]
    assert.equal(failed.kind, "failed")
    assert.equal((failed as Extract<HunkOutcome, { kind: "failed" }>).path, "never.txt")
  },
})

// ----- Parse errors --------------------------------------------------------

cases.push({
  name: "Parse error: ApplyPatchParseError before any I/O",
  async run() {
    const backend = new MemBackend()
    await assert.rejects(
      () => applyPatch("bad", backend, "strict"),
      ApplyPatchParseError,
    )
    // No I/O happened.
    assert.equal(backend.files.size, 0)
  },
})

cases.push({
  name: "applyPatchFromArgs: skips the parser and dispatches directly",
  async run() {
    const backend = new MemBackend()
    const result = await applyPatchFromArgs(
      {
        hunks: [
          {
            kind: "add",
            path: "fromargs.txt",
            contents: "from\nargs\n",
          },
        ],
        patch: "",
        workdir: null,
      },
      backend,
    )
    assert.equal(result.applied, 1)
    assert.equal(backend.files.get("fromargs.txt"), "from\nargs")
  },
})

cases.push({
  name: "computeUpdatedContent: pure helper returns the post-update content",
  async run() {
    const before = "alpha\nbeta\ngamma\n"
    const chunks = [
      {
        changeContext: null as string | null,
        oldLines: ["beta"],
        newLines: ["BETA"],
        isEndOfFile: false,
      },
    ]
    const after = computeUpdatedContent(before, chunks, "x.txt")
    assert.equal(after, "alpha\nBETA\ngamma\n")
  },
})

cases.push({
  name: "UpdateFile: oldLines with surrounding-ws pass tolerates trailing spaces",
  async run() {
    const backend = new MemBackend()
    // Source has trailing spaces on the matched line; the parser preserves them,
    // but the surrounding-ws seek pass should still locate the pattern.
    backend.files.set("ws.txt", "alpha   \nbeta\n")
    const result = await applyPatch(
      [
        "*** Begin Patch",
        "*** Update File: ws.txt",
        "@@",
        "-alpha",
        "+ALPHA",
        "*** End Patch",
      ].join("\n"),
      backend,
      "strict",
    )
    assert.equal(result.applied, 1)
    assert.equal(backend.files.get("ws.txt"), "ALPHA\nbeta\n")
  },
})

// ----- Runner --------------------------------------------------------------

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