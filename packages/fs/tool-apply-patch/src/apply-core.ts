/**
 * Pure data-plane core for the apply_patch pipeline. Turns a parsed `ApplyPatchArgs`
 * into a sequence of file operations executed against a `PatchFileBackend`, then
 * returns a structured report the model can read. No Cordis imports, no fs-specific
 * helpers; the live wiring in `apply.ts` builds the backend from `ctx.fs` + `ctx.shell`,
 * tests build one from `node:fs`.
 *
 * The shape mirrors the upstream codex-rs/apply-patch/src/lib.rs `apply_hunks` flow
 * (https://github.com/openai/codex/blob/main/codex-rs/apply-patch/src/lib.rs), with
 * one deliberate dsh-side gap: `DeleteFile` and the source-path cleanup step of
 * `UpdateFile` with `*** Move to:` both flow through a backend `delete()` hook,
 * which `ctx.fs` does not expose. The adapter in `apply.ts` either rejects with
 * an explicit error or, when an optional `shellBackend` is provided, runs the
 * delete via the shell capability.
 *
 * @module @deepseek-ai/dsh-tool-apply-patch/apply-core
 */

import { parsePatch } from "./parser.ts"
import { seekSequence } from "./seek-sequence.ts"
import type {
  ApplyPatchArgs,
  Hunk,
  ParseError,
  ParseMode,
  UpdateFileChunk,
} from "./types.ts"

/**
 * The minimum filesystem surface a `PatchFileBackend` must expose. `resolve`
 * may throw on sandbox denial; `read` returns `null` for an absent target so
 * the apply pipeline can distinguish create-vs-update without a stat;
 * `write` returns the before/after text plus the resolved operation kind so
 * the tool can emit a faithful summary; `delete` throws on an absent target
 * or a sandbox denial.
 */
export interface PatchFileBackend {
  /** Resolve the model-supplied path into a stable identity, optionally under a sandbox policy. */
  resolve(path: string): Promise<{ displayPath: string }>
  /** Read the file; `null` for an absent target. */
  read(path: string): Promise<string | null>
  /**
   * Write the file. `createIfAbsent: true` rejects an existing file with
   * `AddFileConflictError`; `createIfAbsent: false` overwrites unconditionally.
   * Returns the before text (or `null` for a create) and the after text.
   */
  write(
    path: string,
    content: string,
    options: { createIfAbsent: boolean },
  ): Promise<{ operation: "create" | "update"; before: string | null; after: string }>
  /**
   * Delete the file. Must throw on an absent target; returns the deleted text
   * so the summary can record the deletion. The dsh `ctx.fs` seam does not
   * expose a delete primitive, so this hook either surfaces an explicit
   * `DeleteNotSupportedError` or, when an optional shell backend is provided,
   * runs `rm` via the shell capability.
   */
  delete(path: string): Promise<{ before: string }>
}

/** The outcome of one hunk: either a successful mutation or a structured failure. */
export type HunkOutcome =
  | {
      kind: "added"
      path: string
      operation: "create"
      bytes: number
    }
  | {
      kind: "updated"
      path: string
      operation: "create" | "update"
      movedTo: string | null
      before: string
      after: string
    }
  | {
      kind: "deleted"
      path: string
      before: string
    }
  | {
      kind: "failed"
      path: string
      reason: string
    }

/** The outcome of one full `applyPatch` run. */
export interface ApplyPatchResult {
  hunks: HunkOutcome[]
  /** Number of mutations that succeeded. */
  applied: number
  /** Number of mutations that failed (the rest of the patch was not applied). */
  failed: number
  /** A single-line summary the tool renders into the model-facing envelope. */
  summary: string
}

/** `parsePatch` failure surfaced before any file I/O happens. */
export class ApplyPatchParseError extends Error {
  readonly parseError: ParseError
  constructor(parseError: ParseError) {
    super(formatParseError(parseError))
    this.name = "ApplyPatchParseError"
    this.parseError = parseError
  }
}

/** Thrown when an `AddFile` hunk targets a path that already exists. */
export class AddFileConflictError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Refusing to overwrite existing file: ${path}`)
    this.name = "AddFileConflictError"
    this.path = path
  }
}

/** Thrown when an `UpdateFile` or `DeleteFile` hunk targets an absent file. */
export class FileNotFoundError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`File not found: ${path}`)
    this.name = "FileNotFoundError"
    this.path = path
  }
}

/**
 * Thrown when `seekSequence` cannot locate a chunk's `oldLines` inside the
 * current file content. Mirrors codex-rs's `HunkNotApplied` diagnostic.
 */
export class HunkNotAppliedError extends Error {
  readonly path: string
  readonly chunkIndex: number
  constructor(path: string, chunkIndex: number, detail: string) {
    super(`Update hunk ${chunkIndex + 1} for ${path} did not apply: ${detail}`)
    this.name = "HunkNotAppliedError"
    this.path = path
    this.chunkIndex = chunkIndex
  }
}

/** Thrown when a `DeleteFile` hunk is dispatched to a backend that has no delete primitive. */
export class DeleteNotSupportedError extends Error {
  constructor() {
    super(
      "DeleteFile is not supported through dsh's ctx.fs seam in this composition. "
        + "Use the shell tool to remove the file, then retry without the Delete hunk.",
    )
    this.name = "DeleteNotSupportedError"
  }
}

/** Thrown when an `UpdateFile` `*** Move to:` hunk requires source-path cleanup that the backend cannot perform. */
export class MoveSourceCleanupError extends Error {
  readonly sourcePath: string
  constructor(sourcePath: string) {
    super(
      `Updated file moved to a new path, but the source cleanup of ${sourcePath} failed: `
        + "this composition's ctx.fs does not expose a delete primitive. "
        + "Remove the source manually with the shell tool, then retry without the Move-to.",
    )
    this.name = "MoveSourceCleanupError"
    this.sourcePath = sourcePath
  }
}

/** Convert a `ParseError` into a one-line user-readable string. */
function formatParseError(err: ParseError): string {
  switch (err.kind) {
    case "invalidPatch":
      return `Invalid patch: ${err.message}`
    case "invalidHunk":
      return `Invalid hunk (line ${err.lineNumber}): ${err.message}`
  }
}

/** Split text into lines preserving trailing-newline semantics. */
function splitLines(text: string): string[] {
  const withoutTrailing = text.replace(/\n$/, "")
  return withoutTrailing.split("\n")
}

/** Join lines with '\n' and add a trailing '\n' iff the source ended with one. */
function joinLines(lines: string[], trailingNewline: boolean): string {
  const body = lines.join("\n")
  return trailingNewline ? body + "\n" : body
}

/** Detect whether the original content ended with a newline. */
function hasTrailingNewline(text: string): boolean {
  return text.length > 0 && text.endsWith("\n")
}

/**
 * Apply one `UpdateFileChunk` to a list of source lines, returning the new
 * line list. Mirrors codex-rs's `apply_update_chunk_to_lines`:
 *  1. Resolve the `oldLines` start via `seekSequence`, scanning forward from
 *     the chunk's `changeContext` when one is supplied.
 *  2. Verify every `-` line is consumed (no leftover oldLines).
 *  3. Splice in the `+` lines.
 *
 * When `isEndOfFile` is true, the `oldLines` are allowed to extend past the
 * end of the file content (a common GPT-4.1 emission that uses a stray
 * trailing-line token); we accept whatever trailing context fits and apply
 * the rest as deletions.
 */
export function applyUpdateChunkToLines(
  lines: string[],
  chunk: UpdateFileChunk,
  path: string,
  chunkIndex: number,
): string[] {
  // Empty chunk: codex-rs treats it as a no-op. Defensive -- the parser already
  // rejects this at the hunk level, so reaching here means a programmatic
  // caller (e.g. test fixture) mis-built the chunk.
  if (chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
    return lines
  }

  // Step 1: find the oldLines start via the four-pass seekSequence.
  const start = seekSequence(lines, chunk.oldLines, 0, chunk.isEndOfFile)
  if (start === null) {
    throw new HunkNotAppliedError(
      path,
      chunkIndex,
      "the oldLines pattern was not found in the current file (tried exact / trailing-ws / surrounding-ws / unicode-normalised passes)",
    )
  }

  // Step 2: splice. Replace lines[start..start+oldLines.length] with newLines.
  const head = lines.slice(0, start)
  const tail = lines.slice(start + chunk.oldLines.length)
  return [...head, ...chunk.newLines, ...tail]
}

/**
 * Apply a single `UpdateFile` hunk: read the file, apply each chunk
 * sequentially, write back. Honours `*** Move to:` by writing the modified
 * content at the new path; source-path cleanup is the backend's
 * responsibility (raises `MoveSourceCleanupError` when it cannot).
 */
async function applyUpdateHunk(
  backend: PatchFileBackend,
  hunk: Extract<Hunk, { kind: "update" }>,
): Promise<HunkOutcome> {
  const before = await backend.read(hunk.path)
  if (before === null) {
    throw new FileNotFoundError(hunk.path)
  }
  let lines = splitLines(before)
  for (let i = 0; i < hunk.chunks.length; i += 1) {
    lines = applyUpdateChunkToLines(lines, hunk.chunks[i], hunk.path, i)
  }
  const trailingNewline = hasTrailingNewline(before)
  const newContent = joinLines(lines, trailingNewline)

  // Move-to: write to the new path with the modified content; the source is
  // NOT removed yet. The dsh ctx.fs seam cannot delete, so we record the
  // pending cleanup in the outcome and let the adapter either attempt the
  // shell-based delete or surface a MoveSourceCleanupError.
  const targetPath = hunk.movePath ?? hunk.path
  const writeOp = await backend.write(targetPath, newContent, { createIfAbsent: false })
  const outcome: HunkOutcome = {
    kind: "updated",
    path: targetPath,
    operation: writeOp.operation,
    movedTo: hunk.movePath,
    before: writeOp.before ?? "",
    after: writeOp.after,
  }
  if (hunk.movePath !== null) {
    try {
      await backend.delete(hunk.path)
    } catch (err) {
      if (err instanceof DeleteNotSupportedError) {
        throw new MoveSourceCleanupError(hunk.path)
      }
      throw err
    }
  }
  return outcome
}

/**
 * Apply a single `AddFile` hunk: reject if the target already exists,
 * otherwise create with the parsed content.
 */
async function applyAddHunk(
  backend: PatchFileBackend,
  hunk: Extract<Hunk, { kind: "add" }>,
): Promise<HunkOutcome> {
  // The parser appends a trailing newline after each `+` line. Strip exactly
  // one so the new file's tail matches what GPT-4.1 emitted (the model emits
  // content without a final newline; the parser only adds `\n` per `+` line).
  let contents = hunk.contents
  if (contents.endsWith("\n")) contents = contents.slice(0, -1)
  const existing = await backend.read(hunk.path)
  if (existing !== null) {
    throw new AddFileConflictError(hunk.path)
  }
  const writeOp = await backend.write(hunk.path, contents, { createIfAbsent: true })
  if (writeOp.operation !== "create") {
    // The backend promised createIfAbsent but reported update -- fail loudly
    // rather than treating the race as a successful create.
    throw new AddFileConflictError(hunk.path)
  }
  return {
    kind: "added",
    path: hunk.path,
    operation: "create",
    bytes: writeOp.after.length,
  }
}

/**
 * Apply a single `DeleteFile` hunk: capture the existing content, then ask
 * the backend to delete. The dsh `ctx.fs` seam cannot delete, so this
 * surfaces `DeleteNotSupportedError` when the backend does.
 */
async function applyDeleteHunk(
  backend: PatchFileBackend,
  hunk: Extract<Hunk, { kind: "delete" }>,
): Promise<HunkOutcome> {
  const before = await backend.read(hunk.path)
  if (before === null) {
    throw new FileNotFoundError(hunk.path)
  }
  await backend.delete(hunk.path)
  return { kind: "deleted", path: hunk.path, before }
}

/**
 * Apply one parsed hunk, mapping the kind to the right backend call. All
 * thrown errors carry the hunk's path so the orchestrator can produce a
 * useful summary.
 */
async function applyOneHunk(
  backend: PatchFileBackend,
  hunk: Hunk,
): Promise<HunkOutcome> {
  switch (hunk.kind) {
    case "add":
      return applyAddHunk(backend, hunk)
    case "update":
      return applyUpdateHunk(backend, hunk)
    case "delete":
      return applyDeleteHunk(backend, hunk)
  }
}

/**
 * Format a single-line summary of the apply run for the model-facing
 * envelope. Mirrors codex-rs's `format_patch_summary` tone: "Updated 1 file
 * (a.txt), added 1 file (b.txt)".
 */
function formatSummary(hunks: HunkOutcome[]): string {
  const updated: string[] = []
  const added: string[] = []
  const deleted: string[] = []
  const failed: string[] = []
  for (const h of hunks) {
    if (h.kind === "added") added.push(h.path)
    else if (h.kind === "updated") updated.push(h.path)
    else if (h.kind === "deleted") deleted.push(h.path)
    else failed.push(h.path)
  }
  const parts: string[] = []
  if (added.length > 0) parts.push(`Added ${added.length} file${added.length === 1 ? "" : "s"} (${added.join(", ")})`)
  if (updated.length > 0) parts.push(`Updated ${updated.length} file${updated.length === 1 ? "" : "s"} (${updated.join(", ")})`)
  if (deleted.length > 0) parts.push(`Deleted ${deleted.length} file${deleted.length === 1 ? "" : "s"} (${deleted.join(", ")})`)
  if (failed.length > 0) parts.push(`Failed ${failed.length} hunk${failed.length === 1 ? "" : "s"} (${failed.join(", ")})`)
  return parts.join(". ")
}

/**
 * Run an `applyPatch` text through the parser, then dispatch each hunk to
 * the backend. Stops at the first failure (the upstream codex-rs behaviour:
 * a patch is a unit; partial application is worse than no application).
 *
 * @param patchText - the raw model-supplied patch text.
 * @param backend - the filesystem backend to mutate.
 * @param mode - parser mode; defaults to "lenient" to match codex-rs's local_shell flow.
 * @returns the structured outcome; throws `ApplyPatchParseError` on parse failure or
 *   a backend-specific error class on I/O failure (caller maps these to the model envelope).
 */
export async function applyPatch(
  patchText: string,
  backend: PatchFileBackend,
  mode: ParseMode = "lenient",
): Promise<ApplyPatchResult> {
  const parsed = parsePatch(patchText, mode)
  if ("kind" in parsed) {
    throw new ApplyPatchParseError(parsed)
  }
  return applyPatchFromArgs(parsed, backend)
}

/**
 * Same as `applyPatch`, but skips the parse step (useful for replay tests
 * that already hold a structured `ApplyPatchArgs`).
 */
export async function applyPatchFromArgs(
  args: ApplyPatchArgs,
  backend: PatchFileBackend,
): Promise<ApplyPatchResult> {
  const hunks: HunkOutcome[] = []
  let applied = 0
  let failed = 0
  for (const hunk of args.hunks) {
    try {
      const outcome = await applyOneHunk(backend, hunk)
      hunks.push(outcome)
      applied += 1
    } catch (err) {
      const path = hunk.path
      const reason = err instanceof Error ? err.message : String(err)
      hunks.push({ kind: "failed", path, reason })
      failed += 1
      break
    }
  }
  return {
    hunks,
    applied,
    failed,
    summary: formatSummary(hunks),
  }
}

/**
 * Pure-data helper exposed for tests: compute the post-update content
 * without touching a backend. Mirrors the body of `applyUpdateHunk` after
 * the `backend.read` step.
 */
export function computeUpdatedContent(
  before: string,
  chunks: readonly UpdateFileChunk[],
  path: string,
): string {
  let lines = splitLines(before)
  for (let i = 0; i < chunks.length; i += 1) {
    lines = applyUpdateChunkToLines(lines, chunks[i], path, i)
  }
  return joinLines(lines, hasTrailingNewline(before))
}