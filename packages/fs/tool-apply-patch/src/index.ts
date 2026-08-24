/** `@deepseek-ai/dsh-tool-apply-patch` — Cordis plugin entry point.
 *  This module re-exports the parser and markers; the live tool wiring
 *  (schema, defineTool call, FsWriteIntent bridge) lands after `pnpm install`
 *  resolves `ctx.tools` and `ctx.fs` in the worktree.
 *  seekSequence is a pure helper that does not require any Cordis services.
 *  @module @deepseek-ai/dsh-tool-apply-patch
 */

export { parsePatch } from "./parser.ts"
export { seekSequence } from "./seek-sequence.ts"
export {
  BEGIN_PATCH_MARKER,
  END_PATCH_MARKER,
  ADD_FILE_MARKER,
  DELETE_FILE_MARKER,
  UPDATE_FILE_MARKER,
  MOVE_TO_MARKER,
  EOF_MARKER,
  CHANGE_CONTEXT_MARKER,
  EMPTY_CHANGE_CONTEXT_MARKER,
} from "./markers.ts"
export type {
  ApplyPatchArgs,
  Hunk,
  ParseError,
  ParseMode,
  UpdateFileChunk,
} from "./types.ts"

/** Cordis plugin name used by loader diagnostics. */
export const name = "tool-apply-patch"

/** Services required by the apply_patch tool. */
export const inject = ["tools", "fs", "systemPrompt"]