/**
 * Fuzzy line-sequence locator for `apply_patch` UpdateFile chunks.
 * Mirrors codex-rs/apply-patch/src/seek_sequence.rs in TypeScript.
 *
 * Match attempts are ordered by decreasing strictness so that the
 * common case stays cheap; the most permissive pass only fires when
 * earlier passes fail.
 *
 * Pass order:
 *   1. Exact byte-for-byte match
 *   2. Match ignoring trailing whitespace
 *   3. Match ignoring leading and trailing whitespace
 *   4. Unicode-normalised match (typographic dashes / quotes / non-breaking
 *      spaces collapsed to ASCII)
 *
 * Returns the 0-based starting index of the match within `lines`, or
 * `null` when no match is found.
 *
 * Special cases handled defensively:
 *   - Empty `pattern` returns `start` (no-op match).
 *   - `pattern.length > lines.length` returns `null` to avoid the
 *     out-of-bounds slice that the upstream Rust implementation
 *     guards against.
 *
 * @module @deepseek-ai/dsh-tool-apply-patch/seek-sequence
 */

/** Normalise typographic punctuation to its ASCII counterpart. */
function normalise(line: string): string {
  let out = ""
  for (const ch of line.trim()) {
    switch (ch) {
      case "‐":
      case "‑":
      case "‒":
      case "–":
      case "—":
      case "―":
      case "−":
        out += "-"
        break
      case "‘":
      case "’":
      case "‚":
      case "‛":
        out += "'"
        break
      case "“":
      case "”":
      case "„":
      case "‟":
        out += '"'
        break
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case " ":
      case "　":
        out += " "
        break
      default:
        out += ch
    }
  }
  return out
}

/**
 * Attempt to find the `pattern` sequence inside `lines` beginning at or
 * after `start`. When `eof` is `true`, the search starts at
 * `lines.length - pattern.length` if that range fits, then falls back to
 * scanning from `start` if the EOF attempt fails.
 */
export function seekSequence(
  lines: readonly string[],
  pattern: readonly string[],
  start: number,
  eof: boolean,
): number | null {
  if (pattern.length === 0) return start
  if (pattern.length > lines.length) return null

  const searchStart =
    eof && lines.length >= pattern.length
      ? lines.length - pattern.length
      : start

  const lastWindowStart = lines.length - pattern.length
  if (searchStart > lastWindowStart) return null

  // Pass 1: exact match.
  for (let i = searchStart; i <= lastWindowStart; i += 1) {
    let ok = true
    for (let j = 0; j < pattern.length; j += 1) {
      if (lines[i + j] !== pattern[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  // Pass 2: trailing whitespace ignored.
  for (let i = searchStart; i <= lastWindowStart; i += 1) {
    let ok = true
    for (let j = 0; j < pattern.length; j += 1) {
      if (lines[i + j].trimEnd() !== pattern[j].trimEnd()) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  // Pass 3: leading and trailing whitespace ignored.
  for (let i = searchStart; i <= lastWindowStart; i += 1) {
    let ok = true
    for (let j = 0; j < pattern.length; j += 1) {
      if (lines[i + j].trim() !== pattern[j].trim()) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  // Pass 4: unicode-normalised match.
  for (let i = searchStart; i <= lastWindowStart; i += 1) {
    let ok = true
    for (let j = 0; j < pattern.length; j += 1) {
      if (normalise(lines[i + j]) !== normalise(pattern[j])) {
        ok = false
        break
      }
    }
    if (ok) return i
  }

  return null
}
