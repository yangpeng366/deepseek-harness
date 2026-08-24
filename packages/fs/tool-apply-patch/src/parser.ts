/** pply_patch parser — TypeScript port of codex-rs/apply-patch/src/parser.rs.
 *  Strict mode mirrors the documented grammar; lenient mode first tries strict
 *  then tolerates <<EOF ... EOF heredoc wrapping that GPT-4.1 emits via
 *  local_shell. This module does not touch the filesystem; consumers
 *  resolve paths against ctx.fs and decide whether to apply each hunk.
 *  @module @deepseek-ai/dsh-tool-apply-patch/parser
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
import type {
  ApplyPatchArgs,
  Hunk,
  ParseError,
  ParseMode,
  UpdateFileChunk,
} from "./types.ts"

/** Strip a trailing CR from each line so CRLF inputs parse identically to LF. */
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n")
}

function invalidPatch(message: string): ParseError {
  return { kind: "invalidPatch", message }
}

function invalidHunk(message: string, lineNumber: number): ParseError {
  return { kind: "invalidHunk", message, lineNumber }
}

/** Run the strict envelope check. */
function checkStrict(
  lines: string[],
): { patchLines: string[]; hunkLines: string[] } | ParseError {
  const trimmed = lines.map((l) => l.trim())
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (first !== BEGIN_PATCH_MARKER) {
    return invalidPatch(
      "The first line of the patch must be '*** Begin Patch'",
    )
  }
  if (last !== END_PATCH_MARKER) {
    return invalidPatch(
      "The last line of the patch must be '*** End Patch'",
    )
  }
  return { patchLines: lines, hunkLines: lines.slice(1, -1) }
}

const HEREDOC_OPENERS = new Set<string>([
  "<<EOF",
  `<<'EOF'`,
  `<<\"EOF\"`,
])

/** Check <<EOF / <<'EOF' / <<\"EOF\" heredoc wrapper. */
function looksLikeHeredoc(lines: string[]): boolean {
  if (lines.length < 4) return false
  if (!HEREDOC_OPENERS.has(lines[0])) return false
  return lines[lines.length - 1].endsWith("EOF")
}

/** Parse the patch text envelope and return the lines between Begin/End. */
function checkBoundaries(
  lines: string[],
  mode: ParseMode,
): { patchLines: string[]; hunkLines: string[] } | ParseError {
  const strictResult = checkStrict(lines)
  if (!("kind" in strictResult)) return strictResult
  if (mode === "lenient" && looksLikeHeredoc(lines)) {
    const inner = lines.slice(1, -1)
    const innerResult = checkStrict(inner)
    if (!("kind" in innerResult)) return innerResult
  }
  return strictResult
}

/** Parse a single hunk header and its body, returning the hunk and the
 *  number of source lines consumed (including the header). */
function parseOneHunk(
  lines: string[],
  lineNumber: number,
): { hunk: Hunk; consumed: number } | ParseError {
  const header = lines[0].trim()
  if (header.startsWith(ADD_FILE_MARKER)) {
    const path = header.slice(ADD_FILE_MARKER.length).trim()
    let contents = ""
    let consumed = 1
    while (consumed < lines.length) {
      const line = lines[consumed]
      if (!line.startsWith("+")) break
      contents += line.slice(1) + "\n"
      consumed += 1
    }
    return { hunk: { kind: "add", path, contents }, consumed }
  }
  if (header.startsWith(DELETE_FILE_MARKER)) {
    const path = header.slice(DELETE_FILE_MARKER.length).trim()
    return { hunk: { kind: "delete", path }, consumed: 1 }
  }
  if (header.startsWith(UPDATE_FILE_MARKER)) {
    const path = header.slice(UPDATE_FILE_MARKER.length).trim()
    let remaining = lines.slice(1)
    let consumed = 1
    let movePath: string | null = null
    if (remaining.length > 0 && remaining[0].trim().startsWith(MOVE_TO_MARKER)) {
      movePath = remaining[0].trim().slice(MOVE_TO_MARKER.length).trim()
      remaining = remaining.slice(1)
      consumed += 1
    }
    const chunks: UpdateFileChunk[] = []
    while (remaining.length > 0) {
      const head = remaining[0].trim()
      if (head === "") {
        consumed += 1
        remaining = remaining.slice(1)
        continue
      }
      if (head.startsWith("*")) break
      const result = parseUpdateChunk(remaining, lineNumber + consumed, chunks.length === 0)
      if ("kind" in result) return result
      chunks.push(result.chunk)
      consumed += result.consumed
      remaining = remaining.slice(result.consumed)
    }
    if (chunks.length === 0) {
      return invalidHunk(
        `Update file hunk for path '\' is empty`,
        lineNumber,
      )
    }
    return {
      hunk: { kind: "update", path, movePath, chunks },
      consumed,
    }
  }
  return invalidHunk(
    `'\' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`,
    lineNumber,
  )
}

function parseUpdateChunk(
  lines: string[],
  lineNumber: number,
  allowMissingContext: boolean,
): { chunk: UpdateFileChunk; consumed: number } | ParseError {
  if (lines.length === 0) {
    return invalidHunk(
      "Update hunk does not contain any lines",
      lineNumber,
    )
  }
  let changeContext: string | null = null
  let startIndex = 0
  if (lines[0] === EMPTY_CHANGE_CONTEXT_MARKER) {
    changeContext = null
    startIndex = 1
  } else if (lines[0].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[0].slice(CHANGE_CONTEXT_MARKER.length)
    startIndex = 1
  } else if (!allowMissingContext) {
    return invalidHunk(
      `Expected update hunk to start with a @@ context marker, got: '\'`,
      lineNumber,
    )
  }
  if (startIndex >= lines.length) {
    return invalidHunk(
      "Update hunk does not contain any lines",
      lineNumber + 1,
    )
  }
  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
  }
  let parsedLines = 0
  for (const line of lines.slice(startIndex)) {
    if (line === EOF_MARKER) {
      if (parsedLines === 0) {
        return invalidHunk(
          "Update hunk does not contain any lines",
          lineNumber + 1,
        )
      }
      chunk.isEndOfFile = true
      parsedLines += 1
      break
    }
    const first = line.charAt(0)
    if (line.length === 0) {
      chunk.oldLines.push("")
      chunk.newLines.push("")
    } else if (first === " ") {
      const body = line.slice(1)
      chunk.oldLines.push(body)
      chunk.newLines.push(body)
    } else if (first === "+") {
      chunk.newLines.push(line.slice(1))
    } else if (first === "-") {
      chunk.oldLines.push(line.slice(1))
    } else {
      if (parsedLines === 0) {
        return invalidHunk(
          `Unexpected line found in update hunk: '\'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
          lineNumber + 1,
        )
      }
      break
    }
    parsedLines += 1
  }
  return { chunk, consumed: parsedLines + startIndex }
}

/** Parse an pply_patch text and return structured hunks.
 *  Default mode is lenient (matches codex-rs, which sets
 *  PARSE_IN_STRICT_MODE = false). Pass "strict" to opt into the
 *  documented grammar only.
 */
export function parsePatch(
  patch: string,
  mode: ParseMode = "lenient",
): ApplyPatchArgs | ParseError {
  const lines = splitLines(patch.trim())
  const boundaryResult = checkBoundaries(lines, mode)
  if ("kind" in boundaryResult) return boundaryResult
  const { patchLines, hunkLines } = boundaryResult
  const hunks: Hunk[] = []
  let remaining = hunkLines
  let lineNumber = 2
  while (remaining.length > 0) {
    const result = parseOneHunk(remaining, lineNumber)
    if ("kind" in result) return result
    hunks.push(result.hunk)
    lineNumber += result.consumed
    remaining = remaining.slice(result.consumed)
  }
  return { hunks, patch: patchLines.join("\n"), workdir: null }
}