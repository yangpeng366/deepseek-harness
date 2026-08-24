/** apply_patch streaming parser — TypeScript port of
 *  codex-rs/apply-patch/src/streaming_parser.rs.
 *
 *  Accepts patch fragments via `pushDelta(delta: string)` and emits a snapshot
 *  of the accumulated hunks each call; `finish()` validates that the patch
 *  terminated with `*** End Patch` and surfaces any trailing buffered line.
 *  This module is pure data-plane and never touches the filesystem; consumers
 *  build a `PatchFileBackend` from `ctx.fs` and hand each `pushDelta` result
 *  to it once `finish()` has succeeded.
 *
 *  Mirrors `codex-rs/apply-patch/src/streaming_parser.rs` line-by-line:
 *  - `pushDelta` walks the delta one code-point at a time, accumulating a
 *    `lineBuffer` until a `\n`; trailing `\r` is stripped (so CRLF inputs
 *    parse identically to LF).
 *  - `processLine` dispatches on the current `mode`. Same precedence and
 *    same error messages as the Rust reference (incl. the `line.is_empty()`
 *    carve-out for bare empty update hunk lines).
 *  - `finish` requires `StreamingParserMode.EndedPatch`; any non-empty
 *    trailing buffer is processed (single-line patches are accepted without
 *    a trailing newline).
 *  @module @deepseek-ai/dsh-tool-apply-patch/streaming-parser
 */

import {
  ADD_FILE_MARKER,
  BEGIN_PATCH_MARKER,
  CHANGE_CONTEXT_MARKER,
  DELETE_FILE_MARKER,
  EMPTY_CHANGE_CONTEXT_MARKER,
  END_PATCH_MARKER,
  EOF_MARKER,
  MOVE_TO_MARKER,
  UPDATE_FILE_MARKER,
} from "./markers.ts"
import type { Hunk, ParseError, UpdateFileChunk } from "./types.ts"

/** Streaming state machine — mirrors `StreamingParserMode` in codex-rs. */
type StreamingParserMode =
  | "notStarted"
  | "startedPatch"
  | "addFile"
  | "deleteFile"
  | "updateFile"
  | "endedPatch"

interface StreamingParserState {
  mode: StreamingParserMode
  hunks: Hunk[]
  /** When `mode === "updateFile"`, the line number of the `*** Update File: …`
   *  header — used to attribute empty-hunk errors to the right place. */
  updateHunkLineNumber: number
}

/** Public contract for the streaming parser. */
export interface StreamingPatchParser {
  /** Append more patch text. Returns a snapshot of the accumulated hunks. */
  pushDelta(delta: string): Hunk[] | ParseError
  /** Validate the trailing buffer and the `*** End Patch` terminator. */
  finish(): Hunk[] | ParseError
}

/** Sentinel error returned in place of `Result::Err`; mirrors `ParseError`. */
function invalidPatch(message: string): ParseError {
  return { kind: "invalidPatch", message }
}

function invalidHunk(message: string, lineNumber: number): ParseError {
  return { kind: "invalidHunk", message, lineNumber }
}

const INVALID_HUNK_HEADER_TEMPLATE =
  "'{trimmed}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'"

/** Build an empty `UpdateFileChunk` with no context and no lines. */
function emptyChunk(): UpdateFileChunk {
  return { changeContext: null, oldLines: [], newLines: [], isEndOfFile: false }
}

/** Build a `StreamingPatchParser`. */
export function createStreamingPatchParser(): StreamingPatchParser {
  const state: StreamingParserState = {
    mode: "notStarted",
    hunks: [],
    updateHunkLineNumber: 0,
  }
  let lineBuffer = ""
  let lineNumber = 0

  function ensureUpdateHunkIsNotEmpty(line: string): null | ParseError {
    const last = state.hunks[state.hunks.length - 1]
    if (!last || last.kind !== "update") return null
    const lastChunk = last.chunks[last.chunks.length - 1]
    if (last.chunks.length === 0 && state.mode === "updateFile") {
      return invalidHunk(
        `Update file hunk for path '${last.path}' is empty`,
        state.updateHunkLineNumber,
      )
    }
    if (lastChunk && lastChunk.oldLines.length === 0 && lastChunk.newLines.length === 0) {
      if (line === END_PATCH_MARKER) {
        return invalidHunk("Update hunk does not contain any lines", lineNumber)
      }
      return invalidHunk(
        `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
        lineNumber,
      )
    }
    return null
  }

  /** Recognise the four cross-state transitions: ADD/DELETE/UPDATE/END.
   *  Returns `true` when the line was a header / terminator and the caller
   *  should stop processing this line further; `false` when the line is
   *  ordinary content for the current mode; a `ParseError` otherwise. */
  function handleHunkHeadersAndEndPatch(trimmed: string): true | false | ParseError {
    if (trimmed === END_PATCH_MARKER) {
      const err = ensureUpdateHunkIsNotEmpty(trimmed)
      if (err) return err
      state.mode = "endedPatch"
      return true
    }
    if (trimmed.startsWith(ADD_FILE_MARKER)) {
      const err = ensureUpdateHunkIsNotEmpty(trimmed)
      if (err) return err
      state.hunks.push({ kind: "add", path: trimmed.slice(ADD_FILE_MARKER.length), contents: "" })
      state.mode = "addFile"
      return true
    }
    if (trimmed.startsWith(DELETE_FILE_MARKER)) {
      const err = ensureUpdateHunkIsNotEmpty(trimmed)
      if (err) return err
      state.hunks.push({ kind: "delete", path: trimmed.slice(DELETE_FILE_MARKER.length) })
      state.mode = "deleteFile"
      return true
    }
    if (trimmed.startsWith(UPDATE_FILE_MARKER)) {
      const err = ensureUpdateHunkIsNotEmpty(trimmed)
      if (err) return err
      state.hunks.push({
        kind: "update",
        path: trimmed.slice(UPDATE_FILE_MARKER.length),
        movePath: null,
        chunks: [],
      })
      state.mode = "updateFile"
      state.updateHunkLineNumber = lineNumber
      return true
    }
    return false
  }

  function processLine(line: string): null | ParseError {
    const trimmed = line.trim()
    switch (state.mode) {
      case "notStarted": {
        if (trimmed === BEGIN_PATCH_MARKER) {
          state.mode = "startedPatch"
          return null
        }
        return invalidPatch("The first line of the patch must be '*** Begin Patch'")
      }
      case "startedPatch": {
        const r = handleHunkHeadersAndEndPatch(trimmed)
        if (r === true) return null
        if (r !== false) return r
        return invalidHunk(
          INVALID_HUNK_HEADER_TEMPLATE.replace("{trimmed}", trimmed),
          lineNumber,
        )
      }
      case "addFile": {
        const r = handleHunkHeadersAndEndPatch(trimmed)
        if (r === true) return null
        if (r !== false) return r
        if (line.startsWith("+")) {
          const last = state.hunks[state.hunks.length - 1]
          if (last && last.kind === "add") {
            last.contents += line.slice(1) + "\n"
          }
          return null
        }
        return invalidHunk(
          INVALID_HUNK_HEADER_TEMPLATE.replace("{trimmed}", trimmed),
          lineNumber,
        )
      }
      case "deleteFile": {
        const r = handleHunkHeadersAndEndPatch(trimmed)
        if (r === true) return null
        if (r !== false) return r
        return invalidHunk(
          INVALID_HUNK_HEADER_TEMPLATE.replace("{trimmed}", trimmed),
          lineNumber,
        )
      }
      case "updateFile": {
        const updateLine = line.trimEnd()
        const r = handleHunkHeadersAndEndPatch(updateLine)
        if (r === true) return null
        if (r !== false) return r
        const last = state.hunks[state.hunks.length - 1]
        if (!last || last.kind !== "update") {
          return invalidHunk(
            `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
            lineNumber,
          )
        }
        const lastChunk = last.chunks[last.chunks.length - 1]
        const chunkIsEmpty =
          !!lastChunk && lastChunk.oldLines.length === 0 && lastChunk.newLines.length === 0
        const looksLikeContextMarker =
          updateLine === EMPTY_CHANGE_CONTEXT_MARKER ||
          updateLine.startsWith(CHANGE_CONTEXT_MARKER)

        if (
          last.chunks.length === 0 &&
          last.movePath === null &&
          updateLine.startsWith(MOVE_TO_MARKER)
        ) {
          last.movePath = updateLine.slice(MOVE_TO_MARKER.length)
          return null
        }
        if (looksLikeContextMarker && chunkIsEmpty) {
          return invalidHunk(
            `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
            lineNumber,
          )
        }
        if (updateLine === EMPTY_CHANGE_CONTEXT_MARKER) {
          last.chunks.push(emptyChunk())
          return null
        }
        if (updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
          last.chunks.push({
            changeContext: updateLine.slice(CHANGE_CONTEXT_MARKER.length),
            oldLines: [],
            newLines: [],
            isEndOfFile: false,
          })
          return null
        }
        if (updateLine === EOF_MARKER) {
          if (chunkIsEmpty) {
            return invalidHunk("Update hunk does not contain any lines", lineNumber)
          }
          const c = last.chunks[last.chunks.length - 1]
          if (c) c.isEndOfFile = true
          return null
        }
        if (line === "") {
          if (last.chunks.length === 0) last.chunks.push(emptyChunk())
          const c = last.chunks[last.chunks.length - 1]
          if (c) {
            c.oldLines.push("")
            c.newLines.push("")
          }
          return null
        }
        if (line.startsWith(" ")) {
          if (last.chunks.length === 0) last.chunks.push(emptyChunk())
          const c = last.chunks[last.chunks.length - 1]
          if (c) {
            const body = line.slice(1)
            c.oldLines.push(body)
            c.newLines.push(body)
          }
          return null
        }
        if (line.startsWith("+")) {
          if (last.chunks.length === 0) last.chunks.push(emptyChunk())
          const c = last.chunks[last.chunks.length - 1]
          if (c) c.newLines.push(line.slice(1))
          return null
        }
        if (line.startsWith("-")) {
          if (last.chunks.length === 0) last.chunks.push(emptyChunk())
          const c = last.chunks[last.chunks.length - 1]
          if (c) c.oldLines.push(line.slice(1))
          return null
        }
        if (lastChunk && (lastChunk.oldLines.length > 0 || lastChunk.newLines.length > 0)) {
          return invalidHunk(
            `Expected update hunk to start with a @@ context marker, got: '${line}'`,
            lineNumber,
          )
        }
        return invalidHunk(
          `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          lineNumber,
        )
      }
      case "endedPatch":
        return null
    }
  }

  function snapshot(): Hunk[] {
    return state.hunks.map((h) => {
      if (h.kind === "add") return { kind: "add", path: h.path, contents: h.contents }
      if (h.kind === "delete") return { kind: "delete", path: h.path }
      return {
        kind: "update",
        path: h.path,
        movePath: h.movePath,
        chunks: h.chunks.map((c) => ({
          changeContext: c.changeContext,
          oldLines: [...c.oldLines],
          newLines: [...c.newLines],
          isEndOfFile: c.isEndOfFile,
        })),
      }
    })
  }

  function pushDelta(delta: string): Hunk[] | ParseError {
    for (const ch of delta) {
      if (ch === "\n") {
        let line = lineBuffer
        lineBuffer = ""
        if (line.endsWith("\r")) line = line.slice(0, -1)
        lineNumber += 1
        const err = processLine(line)
        if (err) return err
      } else {
        lineBuffer += ch
      }
    }
    return snapshot()
  }

  function finish(): Hunk[] | ParseError {
    if (lineBuffer !== "") {
      const line = lineBuffer
      lineBuffer = ""
      lineNumber += 1
      const trimmed = line.trim()
      if (trimmed === END_PATCH_MARKER) {
        const err = ensureUpdateHunkIsNotEmpty(trimmed)
        if (err) return err
        state.mode = "endedPatch"
      } else {
        const err = processLine(line)
        if (err) return err
      }
    }
    if (state.mode !== "endedPatch") {
      return invalidPatch("The last line of the patch must be '*** End Patch'")
    }
    return snapshot()
  }

  return { pushDelta, finish }
}
