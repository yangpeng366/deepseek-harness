/**
 * Keyless unit tests for seek-sequence.ts. Mirrors the four assertions
 * from codex-rs/apply-patch/src/seek_sequence.rs plus a Unicode
 * normalisation round-trip and a defensive bounds check.
 *
 * Run with: `tsx tests/seek-sequence.spec.ts` (no vitest install required).
 */

import { strict as assert } from "node:assert"
import { seekSequence } from "../src/seek-sequence.ts"

interface TestCase {
  name: string
  run: () => void
}

const cases: TestCase[] = [
  {
    name: "exact match returns starting index",
    run: () => {
      const lines = ["foo", "bar", "baz"]
      const pattern = ["bar", "baz"]
      assert.equal(seekSequence(lines, pattern, 0, false), 1)
    },
  },
  {
    name: "rstrip match ignores trailing whitespace",
    run: () => {
      const lines = ["foo   ", "bar		"]
      const pattern = ["foo", "bar"]
      assert.equal(seekSequence(lines, pattern, 0, false), 0)
    },
  },
  {
    name: "trim match ignores leading and trailing whitespace",
    run: () => {
      const lines = ["    foo   ", "   bar	"]
      const pattern = ["foo", "bar"]
      assert.equal(seekSequence(lines, pattern, 0, false), 0)
    },
  },
  {
    name: "pattern longer than input returns null (no panic)",
    run: () => {
      const lines = ["just one line"]
      const pattern = ["too", "many", "lines"]
      assert.equal(seekSequence(lines, pattern, 0, false), null)
    },
  },
  {
    name: "empty pattern returns start",
    run: () => {
      const lines = ["foo", "bar"]
      assert.equal(seekSequence(lines, [], 0, false), 0)
      assert.equal(seekSequence(lines, [], 1, false), 1)
    },
  },
  {
    name: "start offset skips earlier occurrences",
    run: () => {
      const lines = ["a", "b", "a", "b"]
      const pattern = ["a", "b"]
      assert.equal(seekSequence(lines, pattern, 2, false), 2)
    },
  },
  {
    name: "eof: matches at the tail when possible",
    run: () => {
      const lines = ["a", "b", "c", "d"]
      const pattern = ["c", "d"]
      assert.equal(seekSequence(lines, pattern, 0, true), 2)
    },
  },
  {
    name: "unicode normalisation matches typographic quotes",
    run: () => {
      // File contains typographic double-quotes, pattern uses ASCII.
      const lines = ["name = “hello”"]
      const pattern = ['name = ' + String.fromCharCode(34) + 'hello' + String.fromCharCode(34)]
      assert.equal(seekSequence(lines, pattern, 0, false), 0)
    },
  },
  {
    name: "no match returns null even after permissive passes",
    run: () => {
      const lines = ["alpha", "beta", "gamma"]
      const pattern = ["x", "y", "z"]
      assert.equal(seekSequence(lines, pattern, 0, false), null)
    },
  },
]

let passed = 0
let failed = 0
for (const tc of cases) {
  try {
    tc.run()
    console.log(`ok  ${tc.name}`)
    passed += 1
  } catch (err) {
    console.error(`FAIL ${tc.name}: ${(err as Error).message}`)
    failed += 1
  }
}

console.log(`
${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
