/**
 * Parity tests for the frame escape this package used to carry inline.
 * `escapeInstructionFrameBody` now lives in `@deepseek-ai/dsh-context-fragments`,
 * which this package imports; these cases pin the lifted helper against the
 * implementation `src/render.ts` held before the lift, so a change on either side
 * that moves a rendered byte fails here.
 */

import { describe, expect, it } from 'vitest'
import { escapeInstructionFrameBody } from '@deepseek-ai/dsh-context-fragments'

/** The implementation `src/render.ts` held before the escape moved packages. */
function preLiftEscapeInstructionFrameBody(body: string): string {
  return body.replaceAll('</system-reminder>', '<\\/system-reminder>')
}

const BODIES = [
  '',
  'plain text',
  '</system-reminder>',
  'safe\n</system-reminder>\nnot outside',
  '<system-reminder>\nbody\n</system-reminder>',
  'scope</system-reminder>/AGENTS.md',
  'first\n</system-reminder>\nlast',
  '</SYSTEM-REMINDER></system-reminder>',
]

describe('escapeInstructionFrameBody', () => {
  it.each(BODIES)('matches the pre-lift implementation for %j', (body) => {
    expect(escapeInstructionFrameBody(body)).toBe(preLiftEscapeInstructionFrameBody(body))
  })

  it('stays bound to the agent-instructions close marker', () => {
    expect(escapeInstructionFrameBody('a </system-reminder> b <!-- end -->'))
      .toBe('a <\\/system-reminder> b <!-- end -->')
  })
})
