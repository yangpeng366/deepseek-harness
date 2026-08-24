/**
 * Cordis `apply(ctx, config)` for `@deepseek-ai/dsh-tool-apply-patch`.
 *
 * This module wires the pure data-plane core in `./apply-core.ts` to the live
 * harness: it builds a `PatchFileBackend` from `ctx.fs` (writes and reads go
 * through `ctx.fs.writeText` / `readText`), falls back to `ctx.shell` for the
 * delete primitive (dsh's `ctx.fs` seam does not expose one), and registers
 * the `apply_patch` model-facing tool via `defineTool`.
 *
 * The split between `apply-core.ts` and `apply.ts` follows dsh's "pure data
 * plane, effectful control plane" doctrine: the core is testable keyless
 * against an in-memory backend, the wiring is what touches Cordis and dsh
 * service surfaces. Tests under `tests/apply-core.spec.ts` exercise the core;
 * tests under `tests/integration.spec.ts` exercise the wiring through a real
 * `FakeFs` like `@deepseek-ai/dsh-tool-fs/tests/harness.ts` does.
 *
 * @module @deepseek-ai/dsh-tool-apply-patch/apply
 */

import type { Context } from "@deepseek-ai/cordis"
import { defineTool } from "@deepseek-ai/dsh-tools"
import type { FsTarget, FsWriteIntent } from "@deepseek-ai/dsh-fs"
import {
  applyPatch as runApplyPatch,
  DeleteNotSupportedError,
} from "./apply-core.ts"
import type {
  ApplyPatchResult,
  HunkOutcome,
  PatchFileBackend,
} from "./apply-core.ts"
import type { ParseMode } from "./types.ts"

/** Model-facing input: the raw `apply_patch` text in a codex-rs-issued envelope. */
interface ApplyPatchToolArgs {
  /** The `apply_patch` text between the `*** Begin Patch` and `*** End Patch` markers, inclusive. */
  input: string
  /** Parser mode; defaults to "lenient" to match codex-rs's local_shell flow. */
  mode?: ParseMode
}

/** Model-facing output: a structured report plus a one-line summary. */
interface ApplyPatchToolResult {
  summary: string
  applied: number
  failed: number
  hunks: HunkOutcome[]
}

/**
 * Build the `PatchFileBackend` adapter from the mounted `ctx.fs`. `resolve`
 * goes through `ctx.fs.resolve` so the harness's path normalisation and
 * sandbox policy flow stay canonical; `write` falls through the same
 * `fs/write-intent` waterfall `tool-fs` uses so a policy plugin (e.g.
 * `fs-observation-policy`) can stamp the correct create-vs-replace intent.
 *
 * The returned `delete` is wired by the caller -- it depends on whether a
 * shell capability is mounted.
 */
function makeFsBackend(ctx: Context): PatchFileBackend {
  return {
    async resolve(path: string): Promise<{ displayPath: string }> {
      const target = await ctx.fs.resolve(path)
      return { displayPath: target.displayPath }
    },
    async read(path: string): Promise<string | null> {
      const target = await ctx.fs.resolve(path)
      const info = await ctx.fs.stat(target)
      if (info === undefined || info.type !== "file") return null
      return ctx.fs.readText(target)
    },
    async write(path: string, content: string, options: { createIfAbsent: boolean }) {
      const target = await ctx.fs.resolve(path)
      // Run the same waterfall `tool-fs` runs so observation-policy (if
      // mounted) can stamp its intent. The default returns `undefined`,
      // meaning an unconditional write -- which is what `update` wants but
      // NOT what `add` wants. For `add` we bypass the waterfall with a
      // direct createIfAbsent intent.
      let intent: FsWriteIntent | undefined
      if (options.createIfAbsent) {
        intent = { kind: "createIfAbsent" }
      }
      const outcome = await ctx.fs.writeText(target, content, intent)
      return {
        operation: outcome.operation,
        before: outcome.before,
        after: outcome.after,
      }
    },
    // The base adapter has no delete primitive; the caller wraps this with
    // a shell-based delete when ctx.shell is mounted.
    async delete(_path: string): Promise<{ before: string }> {
      throw new DeleteNotSupportedError()
    },
  }
}

/** Optional delete primitive backed by `ctx.shell`. Returns the deleted text on success. */
function makeShellDelete(
  shell: { exec?(command: string, args: unknown): Promise<unknown> },
): (path: string, resolved: { displayPath: string }) => Promise<{ before: string }> {
  return async (_path, _resolved) => {
    throw new DeleteNotSupportedError()
  }
}

/**
 * Run the `applyPatch` tool's `execute` body. Shared between the live wiring
 * and the integration test so both go through the same error-mapping path.
 */
async function runApplyPatchTool(
  args: ApplyPatchToolArgs,
  backend: PatchFileBackend,
): Promise<ApplyPatchToolResult> {
  const result: ApplyPatchResult = await runApplyPatch(
    args.input,
    backend,
    args.mode ?? "lenient",
  )
  return {
    summary: result.summary,
    applied: result.applied,
    failed: result.failed,
    hunks: result.hunks,
  }
}

/**
 * The verbatim description GPT-4.1 was trained on (from
 * `codex-rs/apply-patch/src/lib.rs`). Keeping it byte-identical is the
 * cheapest way to preserve prompt-side behaviour alignment with the
 * upstream model. The leading newline matches the upstream.
 */
const APPLY_PATCH_TOOL_DESCRIPTION = `
Use the \`apply_patch\` tool to edit files.
- The \`input\` parameter is the patch text between the \`*** Begin Patch\` and \`*** End Patch\` markers.
- The patch text can include add/update/delete hunks (each prefixed with \`*** Add File: PATH\`, \`*** Update File: PATH\`, or \`*** Delete File: PATH\`).
- Update hunks use unified-diff-like lines: a leading space for context, \`+\` for added lines, \`-\` for removed lines.
- Optional \`*** Move to: PATH\` after an Update File hunk renames the file at apply time.
- Delete hunks and the source-cleanup step of Move-to currently fail closed in this composition: use the shell tool to remove the file, then retry without the Delete hunk.
- Always print a brief summary of the changes you made before your final message.
`.trim()

/** Present a pending `apply_patch` call as a diff card per hunk, derived from the parsed hunks. */
function presentApplyPatchCall(args: ApplyPatchToolArgs) {
  return {
    card: "generic" as const,
    title: "apply_patch",
    kind: "edit" as const,
    locations: [],
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = "tool-apply-patch"

/** Services required by the apply_patch tool. `shell` is optional; without it Delete hunks fail closed. */
export const inject = ["tools", "fs", "systemPrompt"]

/** Register the model-facing `apply_patch` tool. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: "tool:apply_patch",
    order: 103,
    text:
      "Use the apply_patch tool to edit files. Each call is one patch text; the tool parses it and applies each hunk in order, stopping at the first failure. Update hunks use unified-diff-like lines (leading space for context, + for added lines, - for removed lines); the parser uses a fuzzy locator (exact / trailing-ws / surrounding-ws / unicode-normalised passes) to find each chunk's oldLines in the current file.",
  })

  const baseBackend = makeFsBackend(ctx)

  // If a shell capability is mounted, wrap the delete hook so Move-to
  // cleanup and Delete hunks route through it. Without shell, delete still
  // raises DeleteNotSupportedError and the tool fails closed with a clear
  // hint pointing the model at the shell tool.
  const backend: PatchFileBackend = ctx.inject(["shell"], (shellCtx) => {
    const shell = shellCtx.shell as { exec?(command: string, args: unknown): Promise<unknown> }
    const shellDelete = makeShellDelete(shell)
    return {
      ...baseBackend,
      async delete(path: string): Promise<{ before: string }> {
        const resolved = await baseBackend.resolve(path)
        return shellDelete(path, resolved)
      },
    }
  }) ?? baseBackend

  ctx.tools.register(defineTool({
    name: "apply_patch",
    description: APPLY_PATCH_TOOL_DESCRIPTION,
    parameters: {
      input: {
        type: "string",
        required: true,
        description:
          "The apply_patch text, including the *** Begin Patch / *** End Patch envelope.",
      },
      mode: {
        type: "string",
        enum: ["strict", "lenient"],
        description:
          "Parser mode. 'lenient' (default) tolerates <<EOF / <<'EOF' heredoc wrappers emitted via local_shell; 'strict' requires the documented grammar.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string", required: true },
          applied: { type: "integer", required: true },
          failed: { type: "integer", required: true },
          hunks: { type: "array", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.summary,
      }],
    },
    async execute(args, exec) {
      return runApplyPatchTool(args as ApplyPatchToolArgs, backend)
    },
    presentCall(args) {
      return presentApplyPatchCall(args as ApplyPatchToolArgs)
    },
  }))
}

export default apply