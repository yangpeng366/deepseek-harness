/**
 * Content-blind escape helpers for context-fragment frames.
 *
 * Every contributor that emits a recognizable open/close pair must escape the
 * body so untrusted text cannot close the plugin-owned frame. The helpers in
 * this module are pure functions of `(body, marker)`; they never read or
 * mutate shared state, so two contributors calling the same helper against
 * the same inputs always produce byte-identical output.
 *
 * @module @deepseek-ai/dsh-context-fragments/escape
 */

/**
 * Escape one frame body so the close marker cannot terminate the plugin-owned
 * frame. The helper inserts a single backslash immediately after the leading
 * `<` of every exact match, so `</system-reminder>` becomes `<\/system-reminder>`
 * and `<!-- end -->` becomes `<\!-- end -->`. Other whitespace, case, or
 * partial matches pass through unchanged. A marker that does not start with
 * `<` is returned unchanged; the registry rejects non-`<` markers upstream.
 *
 * Behavior matches `escapeInstructionFrameBody` from
 * `packages/context/agent-instructions/src/render.ts:81` byte-for-byte when
 * `marker` is `</system-reminder>`, and the equivalence is asserted by
 * `tests/escape.spec.ts` until Step 4 retires the duplicate.
 *
 * @param body - untrusted fragment text, possibly containing one or more
 *   literal copies of `marker`.
 * @param marker - the close marker the registry has reserved for this frame.
 *   Empty markers are rejected at the registry boundary; this helper still
 *   returns `body` unchanged for them, so callers must validate upstream.
 * @returns the body with every exact-match `marker` rewritten so its leading
 *   `<` is followed by a single backslash; any other text is preserved
 *   exactly.
 */
export function escapeFrameBody(body: string, marker: string): string {
  if (marker === '') return body
  const escapedMarker = marker.replace(/^</, '<\\')
  return body.replaceAll(marker, escapedMarker)
}

/**
 * Escape one agent-instructions frame body. The helper is a specialized
 * `escapeFrameBody` bound to the agent-instructions close marker so callers
 * do not have to import the literal constant. It exists for the migration
 * window only and is removed in Step 4 when the agent-instructions package
 * imports the registry-owned escape.
 *
 * @param body - agent-instructions body, possibly containing one or more
 *   literal copies of the close marker.
 * @returns the body with every literal `</system-reminder>` rewritten to
 *   `<\/system-reminder>`.
 */
export function escapeInstructionFrameBody(body: string): string {
  return escapeFrameBody(body, '</system-reminder>')
}
