/** Streaming parser tests — TypeScript port of `streaming_parser.rs`
 *  `#[cfg(test)] mod tests`. Mirrors the eight
 *  `test_streaming_patch_parser_*` cases in
 *  `codex-rs/apply-patch/src/streaming_parser.rs` so a model-visible
 *  behaviour change in the reference is caught here without rebuilding
 *  the Rust workspace.
 *
 *  Run with: `tsx tests/streaming-parser.spec.ts`
 *  (no vitest install required; matches the suite''s prevailing style).
 */
import { strict as assert } from 'node:assert'

import { createStreamingPatchParser } from '../src/streaming-parser.ts'
import type { Hunk, ParseError } from '../src/types.ts'

interface TestCase {
  name: string
  run: () => void
}

const isError = (r: Hunk[] | ParseError): r is ParseError =>
  !Array.isArray(r)

const cases: TestCase[] = [
  {
    name: 'streams complete lines before end patch — Add File',
    run: () => {
      const parser = createStreamingPatchParser()
      const r1 = parser.pushDelta(
        '*** Begin Patch\n*** Add File: src/hello.txt\n+hello\n+wor',
      )
      assert.deepEqual(r1, [
        { kind: 'add', path: 'src/hello.txt', contents: 'hello\n' },
      ])
      const r2 = parser.pushDelta('ld\n')
      assert.deepEqual(r2, [
        {
          kind: 'add',
          path: 'src/hello.txt',
          contents: 'hello\nworld\n',
        },
      ])
    },
  },
  {
    name: 'streams complete lines before end patch — Update File with Move to',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: src/old.rs\n*** Move to: src/new.rs\n@@\n-old\n+new\n',
      )
      assert.deepEqual(r, [
        {
          kind: 'update',
          path: 'src/old.rs',
          movePath: 'src/new.rs',
          chunks: [
            {
              changeContext: null,
              oldLines: ['old'],
              newLines: ['new'],
              isEndOfFile: false,
            },
          ],
        },
      ])
    },
  },
  {
    name: 'streams complete lines before end patch — Delete File split across two deltas',
    run: () => {
      const parser = createStreamingPatchParser()
      const r1 = parser.pushDelta(
        '*** Begin Patch\n*** Delete File: gone.txt',
      )
      assert.deepEqual(r1, [])
      const r2 = parser.pushDelta('\n')
      assert.deepEqual(r2, [{ kind: 'delete', path: 'gone.txt' }])
    },
  },
  {
    name: 'streams complete lines before end patch — mixed Add + Delete in one delta',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Add File: src/one.txt\n+one\n*** Delete File: src/two.txt\n',
      )
      assert.deepEqual(r, [
        { kind: 'add', path: 'src/one.txt', contents: 'one\n' },
        { kind: 'delete', path: 'src/two.txt' },
      ])
    },
  },
  {
    name: 'large patch split by character yields monotonic hunk counts',
    run: () => {
      const patch = [
        '*** Begin Patch',
        '*** Add File: docs/release-notes.md',
        '+# Release notes',
        '+',
        '+## CLI',
        '+- Surface apply_patch progress while arguments stream.',
        '+- Keep final patch application gated on the completed tool call.',
        '+- Include file summaries in the progress event payload.',
        '*** Update File: src/config.rs',
        '@@ impl Config',
        '-    pub apply_patch_progress: bool,',
        '+    pub stream_apply_patch_progress: bool,',
        '     pub include_diagnostics: bool,',
        '@@ fn default_progress_interval()',
        '-    Duration::from_millis(500)',
        '+    Duration::from_millis(250)',
        '*** Delete File: src/legacy_patch_progress.rs',
        '*** Update File: crates/cli/src/main.rs',
        '*** Move to: crates/cli/src/bin/codex.rs',
        '@@ fn run()',
        '-    let args = Args::parse();',
        '-    dispatch(args)',
        '+    let cli = Cli::parse();',
        '+    dispatch(cli)',
        '*** Add File: tests/fixtures/apply_patch_progress.json',
        '+{',
        '+  "type": "apply_patch_progress",',
        '+  "hunks": [',
        '+    { "operation": "add", "path": "docs/release-notes.md" },',
        '+    { "operation": "update", "path": "src/config.rs" }',
        '+  ]',
        '+}',
        '*** Update File: README.md',
        '@@ Development workflow',
        ' Build the Rust workspace before opening a pull request.',
        '+When touching streamed tool calls, include parser coverage for partial input.',
        '+Prefer tests that exercise the exact event payload shape.',
        '*** Delete File: docs/old-apply-patch-progress.md',
        '*** End Patch',
      ].join('\n')

      const parser = createStreamingPatchParser()
      let maxHunkCount = 0
      const sawHunkCounts: number[] = []
      let hunks: Hunk[] = []
      for (const ch of patch) {
        const updated = parser.pushDelta(ch)
        if (isError(updated)) {
          throw new Error(`parser failed: ${JSON.stringify(updated)}`)
        }
        if (updated.length > 0) {
          const hunkCount = updated.length
          assert.ok(
            hunkCount >= maxHunkCount,
            `hunk count should never decrease while streaming: ${hunkCount} < ${maxHunkCount}`,
          )
          if (hunkCount > maxHunkCount) {
            sawHunkCounts.push(hunkCount)
            maxHunkCount = hunkCount
          }
          hunks = [...updated]
        }
      }
      assert.deepEqual(sawHunkCounts, [1, 2, 3, 4, 5, 6, 7])
      assert.equal(hunks.length, 7)
      const ops = hunks.map((h) => {
        if (h.kind === 'add') return 'add'
        if (h.kind === 'delete') return 'delete'
        return h.movePath ? 'move-update' : 'update'
      })
      assert.deepEqual(ops, [
        'add',
        'update',
        'delete',
        'move-update',
        'add',
        'update',
        'delete',
      ])
    },
  },
  {
    name: 'keeps indented update markers as context lines',
    run: () => {
      const parser = createStreamingPatchParser()
      const result = parser.pushDelta(
        [
          '*** Begin Patch',
          '*** Update File: a.txt',
          '@@',
          '-old a',
          '+new a',
          ' *** Update File: b.txt',
          '@@',
          '-old b',
          '+new b',
          '*** End Patch',
          '',
        ].join('\n'),
      )
      assert.deepEqual(result, [
        {
          kind: 'update',
          path: 'a.txt',
          movePath: null,
          chunks: [
            {
              changeContext: null,
              oldLines: ['old a', '*** Update File: b.txt'],
              newLines: ['new a', '*** Update File: b.txt'],
              isEndOfFile: false,
            },
            {
              changeContext: null,
              oldLines: ['old b'],
              newLines: ['new b'],
              isEndOfFile: false,
            },
          ],
        },
      ])
    },
  },
  {
    name: 'preserves bare empty update lines',
    run: () => {
      const parser = createStreamingPatchParser()
      const result = parser.pushDelta(
        [
          '*** Begin Patch',
          '*** Update File: file.txt',
          '@@',
          ' context before',
          '',
          ' context after',
          '*** End Patch',
          '',
        ].join('\n'),
      )
      assert.deepEqual(result, [
        {
          kind: 'update',
          path: 'file.txt',
          movePath: null,
          chunks: [
            {
              changeContext: null,
              oldLines: ['context before', '', 'context after'],
              newLines: ['context before', '', 'context after'],
              isEndOfFile: false,
            },
          ],
        },
      ])
    },
  },
  {
    name: 'matches line-ending behaviour — CRLF stripped, plain CR-only content preserved',
    run: () => {
      {
        const parser = createStreamingPatchParser()
        const result = parser.pushDelta(
          '*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n',
        )
        assert.deepEqual(result, [
          {
            kind: 'update',
            path: 'file.txt',
            movePath: null,
            chunks: [
              {
                changeContext: null,
                oldLines: ['old'],
                newLines: ['new'],
                isEndOfFile: false,
              },
            ],
          },
        ])
      }
      {
        const parser = createStreamingPatchParser()
        const result = parser.pushDelta(
          '*** Begin Patch\r\n*** Update File: file.txt\r\n@@\r\n-old\r\r\n+new\r\n*** End Patch\r\n',
        )
        assert.deepEqual(result, [
          {
            kind: 'update',
            path: 'file.txt',
            movePath: null,
            chunks: [
              {
                changeContext: null,
                oldLines: ['old\r'],
                newLines: ['new'],
                isEndOfFile: false,
              },
            ],
          },
        ])
      }
    },
  },
  {
    name: 'finish processes the final line without a newline',
    run: () => {
      {
        const parser = createStreamingPatchParser()
        const r1 = parser.pushDelta(
          '*** Begin Patch\n*** Add File: file.txt\n+hello\n*** End Patch',
        )
        assert.deepEqual(r1, [
          { kind: 'add', path: 'file.txt', contents: 'hello\n' },
        ])
        const r2 = parser.finish()
        assert.deepEqual(r2, [
          { kind: 'add', path: 'file.txt', contents: 'hello\n' },
        ])
      }
      {
        const parser = createStreamingPatchParser()
        const r1 = parser.pushDelta(
          '*** Begin Patch\n*** Update File: file.txt\n@@\n-old\n+new\n *** End Patch',
        )
        assert.deepEqual(r1, [
          {
            kind: 'update',
            path: 'file.txt',
            movePath: null,
            chunks: [
              {
                changeContext: null,
                oldLines: ['old'],
                newLines: ['new'],
                isEndOfFile: false,
              },
            ],
          },
        ])
        const r2 = parser.finish()
        assert.deepEqual(r2, [
          {
            kind: 'update',
            path: 'file.txt',
            movePath: null,
            chunks: [
              {
                changeContext: null,
                oldLines: ['old'],
                newLines: ['new'],
                isEndOfFile: false,
              },
            ],
          },
        ])
      }
    },
  },
  {
    name: 'finish requires end patch',
    run: () => {
      const parser = createStreamingPatchParser()
      const r1 = parser.pushDelta(
        '*** Begin Patch\n*** Add File: file.txt\n+hello\n',
      )
      assert.deepEqual(r1, [
        { kind: 'add', path: 'file.txt', contents: 'hello\n' },
      ])
      const r2 = parser.finish()
      assert.deepEqual(r2, {
        kind: 'invalidPatch',
        message: "The last line of the patch must be '*** End Patch'",
      })
    },
  },
  {
    name: 'returns envelope errors before Begin Patch',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta('bad\n')
      assert.deepEqual(r, {
        kind: 'invalidPatch',
        message: "The first line of the patch must be '*** Begin Patch'",
      })
    },
  },
  {
    name: 'returns header errors after Begin Patch',
    run: () => {
      const parser = createStreamingPatchParser()
      const r1 = parser.pushDelta('*** Begin Patch\n')
      assert.deepEqual(r1, [])
      const r2 = parser.pushDelta('bad\n')
      assert.deepEqual(r2, {
        kind: 'invalidHunk',
        message:
          "'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
        lineNumber: 2,
      })
    },
  },
  {
    name: 'returns header errors inside Add File body',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Add File: file.txt\nbad\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message:
          "'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
        lineNumber: 3,
      })
    },
  },
  {
    name: 'returns header errors inside Delete File body',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Delete File: file.txt\nbad\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message:
          "'bad' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'",
        lineNumber: 3,
      })
    },
  },
  {
    name: 'rejects empty Update File before End Patch',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n*** End Patch\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message: "Update file hunk for path 'file.txt' is empty",
        lineNumber: 2,
      })
    },
  },
  {
    name: 'rejects empty Update File before another hunk header',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** Delete File: other.txt\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message: "Update file hunk for path 'old.txt' is empty",
        lineNumber: 2,
      })
    },
  },
  {
    name: 'rejects update hunk with @@ only before End Patch',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n@@\n*** End Patch\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message: 'Update hunk does not contain any lines',
        lineNumber: 4,
      })
    },
  },
  {
    name: 'rejects update hunk with @@ only before End of File',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n@@\n*** End of File\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message: 'Update hunk does not contain any lines',
        lineNumber: 4,
      })
    },
  },
  {
    name: 'rejects @@ immediately after @@',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n@@\n@@\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message:
          "Unexpected line found in update hunk: '@@'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
        lineNumber: 4,
      })
    },
  },
  {
    name: 'rejects bad line in mid-update chunk',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n@@\n-old\nbad\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message:
          "Expected update hunk to start with a @@ context marker, got: 'bad'",
        lineNumber: 5,
      })
    },
  },
  {
    name: 'rejects another hunk header inside update chunk',
    run: () => {
      const parser = createStreamingPatchParser()
      const r = parser.pushDelta(
        '*** Begin Patch\n*** Update File: file.txt\n@@\n*** Update File: other.txt\n',
      )
      assert.deepEqual(r, {
        kind: 'invalidHunk',
        message:
          "Unexpected line found in update hunk: '*** Update File: other.txt'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)",
        lineNumber: 4,
      })
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
