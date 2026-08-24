/** Markers for the `apply_patch` envelope and per-file operations.
 *  Kept verbatim from codex-rs/apply-patch/src/parser.rs so model-facing
 *  output round-trips with the upstream reference implementation.
 *  @module @deepseek-ai/dsh-tool-apply-patch/markers
 */

export const BEGIN_PATCH_MARKER = "*** Begin Patch"
export const END_PATCH_MARKER = "*** End Patch"
export const ADD_FILE_MARKER = "*** Add File: "
export const DELETE_FILE_MARKER = "*** Delete File: "
export const UPDATE_FILE_MARKER = "*** Update File: "
export const MOVE_TO_MARKER = "*** Move to: "
export const EOF_MARKER = "*** End of File"
export const CHANGE_CONTEXT_MARKER = "@@ "
export const EMPTY_CHANGE_CONTEXT_MARKER = "@@"