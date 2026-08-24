/** AST node types for a parsed `apply_patch` text.
 *  Mirrors codex-rs/apply-patch/src/parser.rs `Hunk` and `UpdateFileChunk`.
 *  Path values are POSIX-style strings; consumers resolve them against the
 *  tool''s session cwd and any sandbox policy.
 *  @module @deepseek-ai/dsh-tool-apply-patch/types
 */

export type Hunk =
  | { kind: "add"; path: string; contents: string }
  | { kind: "delete"; path: string }
  | {
      kind: "update"
      path: string
      movePath: string | null
      chunks: UpdateFileChunk[]
    }

export interface UpdateFileChunk {
  changeContext: string | null
  oldLines: string[]
  newLines: string[]
  isEndOfFile: boolean
}

export interface ApplyPatchArgs {
  hunks: Hunk[]
  patch: string
  workdir: string | null
}

export type ParseMode = "strict" | "lenient"

/** Diagnostic error surfaced by `parsePatch`. */
export type ParseError =
  | { kind: "invalidPatch"; message: string }
  | { kind: "invalidHunk"; message: string; lineNumber: number }