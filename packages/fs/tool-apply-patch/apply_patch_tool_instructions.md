Use the `apply_patch` tool to edit files.
- The `input` parameter is the patch text between the `*** Begin Patch` and `*** End Patch` markers.
- The patch text can include add/update/delete hunks (each prefixed with `*** Add File: PATH`, `*** Update File: PATH`, or `*** Delete File: PATH`).
- Update hunks use unified-diff-like lines: a leading space for context, `+` for added lines, `-` for removed lines.
- Optional `*** Move to: PATH` after an Update File hunk renames the file at apply time.
- Delete hunks and the source-cleanup step of Move-to currently fail closed in this composition: use the shell tool to remove the file, then retry without the Delete hunk.
- Always print a brief summary of the changes you made before your final message.