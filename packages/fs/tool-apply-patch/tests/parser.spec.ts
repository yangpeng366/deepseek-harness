/** Keyless parser unit tests for @deepseek-ai/dsh-tool-apply-patch.
 *  Run with: `tsx tests/parser.spec.ts` (no vitest install required).
 *  Mirrors select assertions from codex-rs/apply-patch/src/parser.rs.
 */

import { strict as assert } from "node:assert"
import { parsePatch } from "../src/parser.ts"
import type { ApplyPatchArgs, Hunk } from "../src/types.ts"

interface TestCase {
  name: string
  input: string
  expect: (result: ApplyPatchArgs | ReturnType<typeof parsePatch>) => void
}

const cases: TestCase[] = [
  {
    name: "rejects bad first line",
    input: "bad\n*** End Patch",
    expect: (r) => {
      assert.ok("kind" in r)
      assert.equal(r.kind, "invalidPatch")
    },
  },
  {
    name: "rejects bad hunk header",
    input: "*** Begin Patch\nbad\n*** End Patch",
    expect: (r) => {
      assert.ok("kind" in r)
      assert.equal(r.kind, "invalidHunk")
    },
  },
  {
    name: "parses AddFile with multiple lines",
    input: [
      "*** Begin Patch",
      "*** Add File: hello.txt",
      "+Hello world",
      "+Line two",
      "*** End Patch",
    ].join("\n"),
    expect: (r) => {
      assert.ok("hunks" in r)
      assert.equal(r.hunks.length, 1)
      const h = r.hunks[0]
      assert.equal(h.kind, "add")
      assert.equal(h.path, "hello.txt")
      assert.equal(h.contents, "Hello world\nLine two\n")
    },
  },
  {
    name: "parses DeleteFile",
    input: [
      "*** Begin Patch",
      "*** Delete File: gone.txt",
      "*** End Patch",
    ].join("\n"),
    expect: (r) => {
      assert.ok("hunks" in r)
      assert.equal(r.hunks.length, 1)
      assert.equal(r.hunks[0].kind, "delete")
      assert.equal((r.hunks[0] as { path: string }).path, "gone.txt")
    },
  },
  {
    name: "parses UpdateFile with Move to",
    input: [
      "*** Begin Patch",
      "*** Update File: src/app.py",
      "*** Move to: src/main.py",
      "@@ def greet():",
      "-print('Hi')",
      "+print('Hello')",
      "*** End Patch",
    ].join("\n"),
    expect: (r) => {
      assert.ok("hunks" in r)
      const h = r.hunks[0]
      assert.equal(h.kind, "update")
      if (h.kind === "update") {
        assert.equal(h.path, "src/app.py")
        assert.equal(h.movePath, "src/main.py")
        assert.equal(h.chunks.length, 1)
        assert.equal(h.chunks[0].changeContext, "def greet():")
        assert.deepEqual(h.chunks[0].oldLines, ["print('Hi')"])
        assert.deepEqual(h.chunks[0].newLines, ["print('Hello')"])
      }
    },
  },
  {
    name: "parses multiple hunks in one patch",
    input: [
      "*** Begin Patch",
      "*** Add File: a.txt",
      "+AAA",
      "*** Delete File: b.txt",
      "*** Update File: c.txt",
      "@@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n"),
    expect: (r) => {
      assert.ok("hunks" in r)
      assert.equal(r.hunks.length, 3)
      const kinds = r.hunks.map((h: Hunk) => h.kind)
      assert.deepEqual(kinds, ["add", "delete", "update"])
    },
  },
  {
    name: "UpdateFile empty hunk rejected",
    input: [
      "*** Begin Patch",
      "*** Update File: empty.txt",
      "*** End Patch",
    ].join("\n"),
    expect: (r) => {
      assert.ok("kind" in r)
      assert.equal(r.kind, "invalidHunk")
    },
  },
]

let passed = 0
let failed = 0
for (const tc of cases) {
  try {
    const result = parsePatch(tc.input, "strict")
    tc.expect(result)
    console.log(`ok  ${tc.name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL ${tc.name}: ${(err as Error).message}`)
    failed += 1
  }
}

const lenientCases: TestCase[] = [
  {
    name: "lenient: <<'EOF' heredoc",
    input: [
      "<<'EOF'",
      "*** Begin Patch",
      "*** Add File: x.txt",
      "+X",
      "*** End Patch",
      "EOF",
    ].join("\n"),
    expect: (r) => {
      assert.ok("hunks" in r)
    },
  },
]

for (const tc of lenientCases) {
  try {
    const result = parsePatch(tc.input, "lenient")
    tc.expect(result)
    console.log(`ok  ${tc.name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL ${tc.name}: ${(err as Error).message}`)
    failed += 1
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
