/**
 * Tests for the shared fragment-frame escape. Every assertion targets the
 * Step 1 contract: byte-equivalent output to `escapeInstructionFrameBody`
 * from `packages/context/agent-instructions/src/render.ts:81`, marker-agnostic
 * behavior when a different marker is supplied, and content-blind partial
 * match semantics.
 */

import { describe, expect, it } from 'vitest'
import {
  escapeFrameBody,
  escapeInstructionFrameBody,
} from '@deepseek-ai/dsh-context-fragments'

describe('escapeFrameBody', () => {
  it('returns the body unchanged when the body contains no marker', () => {
    expect(escapeFrameBody('plain instructions', '</system-reminder>'))
      .toBe('plain instructions')
  })

  it('escapes a single literal close marker', () => {
    expect(escapeFrameBody('safe\n</system-reminder>\nnot outside', '</system-reminder>'))
      .toBe('safe\n<\\/system-reminder>\nnot outside')
  })

  it('escapes every occurrence of the marker, not only the first', () => {
    expect(escapeFrameBody('</system-reminder>\n</system-reminder>', '</system-reminder>'))
      .toBe('<\\/system-reminder>\n<\\/system-reminder>')
  })

  it('escapes a marker that appears in the middle of a path', () => {
    expect(escapeFrameBody('scope</system-reminder>/AGENTS.md', '</system-reminder>'))
      .toBe('scope<\\/system-reminder>/AGENTS.md')
  })

  it('leaves the open marker unchanged', () => {
    expect(escapeFrameBody('<system-reminder>\nbody\n</system-reminder>', '</system-reminder>'))
      .toBe('<system-reminder>\nbody\n<\\/system-reminder>')
  })

  it('is case-sensitive and ignores partial matches', () => {
    expect(escapeFrameBody('</SYSTEM-REMINDER></system-reminder></system-reminder>', '</system-reminder>'))
      .toBe('</SYSTEM-REMINDER><\\/system-reminder><\\/system-reminder>')
  })

  it('handles a marker that appears at a line boundary', () => {
    expect(escapeFrameBody('first\n</system-reminder>\nlast', '</system-reminder>'))
      .toBe('first\n<\\/system-reminder>\nlast')
  })

  it('handles a multi-line code block that contains the marker', () => {
    const body = [
      '```',
      'if (close.endsWith("</system-reminder>")) {',
      '  return false',
      '}',
      '```',
    ].join('\n')
    expect(escapeFrameBody(body, '</system-reminder>'))
      .toContain('<\\/system-reminder>')
    expect(escapeFrameBody(body, '</system-reminder>').match(/<\\\/system-reminder>/g))
      .toHaveLength(1)
  })

  it('is marker-agnostic when a different marker is supplied', () => {
    expect(escapeFrameBody('a <!-- end --> b', '<!-- end -->'))
      .toBe('a <\\!-- end --> b')
    expect(escapeFrameBody('a <!-- end --> b <!-- end --> c', '<!-- end -->'))
      .toBe('a <\\!-- end --> b <\\!-- end --> c')
  })

  it('returns the body unchanged when the marker is empty', () => {
    expect(escapeFrameBody('<\\/system-reminder>', ''))
      .toBe('<\\/system-reminder>')
  })
})

describe('escapeInstructionFrameBody', () => {
  it('matches the agent-instructions byte-for-byte for the typical happy path', () => {
    expect(escapeInstructionFrameBody('safe\n</system-reminder>\nnot outside'))
      .toBe('safe\n<\\/system-reminder>\nnot outside')
  })

  it('matches the agent-instructions byte-for-byte when the marker appears in a path', () => {
    expect(escapeInstructionFrameBody('scope</system-reminder>/AGENTS.md'))
      .toBe('scope<\\/system-reminder>/AGENTS.md')
  })

  it('is byte-equivalent to escapeFrameBody called with the agent-instructions marker', () => {
    const cases = [
      'plain text',
      '</system-reminder>',
      'safe\n</system-reminder>\nnot outside',
      '<system-reminder>\nbody\n</system-reminder>',
      'scope</system-reminder>/AGENTS.md',
      'first\n</system-reminder>\nlast',
    ]
    for (const body of cases) {
      expect(escapeInstructionFrameBody(body))
        .toBe(escapeFrameBody(body, '</system-reminder>'))
    }
  })
})
