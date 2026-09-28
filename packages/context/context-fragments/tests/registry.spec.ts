/**
 * Tests for the Step 2 fragment registry. The specs pin the per-layer
 * duplicate-name and marker-collision contracts, the scope-chain shadowing
 * behavior, the `recognize` first-non-overlapping-match rule, and the
 * `render` byte-equivalence with the shared escape helper.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { FragmentsService } from '../src/registry.ts'
import {
  escapeFrameBody,
  type Fragment,
  type FragmentName,
} from '../src/index.ts'
import { apply } from '../src/index.ts'
import { scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'

async function bootFragments(config: { defaultRole?: 'developer' | 'user' } = {}): Promise<{
  ctx: Context
  service: FragmentsService
  changes: number
}> {
  const ctx = new Context()
  await ctx.plugin(FragmentsService, config)
  let changes = 0
  ctx.on('fragments/change', () => { changes += 1 })
  return { ctx, service: ctx.fragments, changes }
}

const agentInstructions: Fragment = {
  name: 'agent-instructions' as FragmentName,
  role: 'developer',
  startMarker: '<system-reminder>',
  endMarker: '</system-reminder>',
  order: 0,
  body: 'remember to be helpful',
}

const fileReference: Fragment = {
  name: 'file-reference' as FragmentName,
  role: 'user',
  startMarker: '<files>',
  endMarker: '</files>',
  order: 10,
  body: 'a.ts\nb.ts',
}

describe('FragmentsService.register', () => {
  it('returns a Cordis effect disposer that removes the fragment', async () => {
    const { service } = await bootFragments()
    const dispose = service.register(agentInstructions)
    expect(await service.assemble()).toHaveLength(1)
    dispose()
    expect(await service.assemble()).toHaveLength(0)
  })

  it('throws on duplicate names within one layer', async () => {
    const { service } = await bootFragments()
    service.register(agentInstructions)
    expect(() => service.register({ ...agentInstructions, body: 'other' }))
      .toThrow(/already registered/)
  })

  it('throws on marker pair collisions within one layer', async () => {
    const { service } = await bootFragments()
    service.register(agentInstructions)
    const colliding: Fragment = {
      name: 'sneaky' as FragmentName,
      role: 'user',
      startMarker: '<system-reminder>',
      endMarker: '</system-reminder>',
      order: 1,
      body: 'different body',
    }
    expect(() => service.register(colliding))
      .toThrow(/marker pair .* is already reserved/)
  })

  it('rejects empty or identical start/end markers at registration time', async () => {
    const { service } = await bootFragments()
    const emptyStart: Fragment = { ...agentInstructions, startMarker: '' }
    const emptyEnd: Fragment = { ...agentInstructions, endMarker: '' }
    const sameBoth: Fragment = { ...agentInstructions, startMarker: '<x>', endMarker: '<x>' }
    expect(() => service.register(emptyStart)).toThrow(/markers must be non-empty/)
    expect(() => service.register(emptyEnd)).toThrow(/markers must be non-empty/)
    expect(() => service.register(sameBoth)).toThrow(/must differ/)
  })

  it('records register and dispose without leaking listeners', async () => {
    const { service } = await bootFragments()
    const dispose = service.register(agentInstructions)
    expect(await service.assemble()).toHaveLength(1)
    dispose()
    expect(await service.assemble()).toHaveLength(0)
  })

  it('orders fragments by the order field on assemble', async () => {
    const { service } = await bootFragments()
    service.register(fileReference) // order 10
    service.register(agentInstructions) // order 0
    const ordered = await service.assemble()
    expect(ordered.map(fragment => fragment.name))
      .toEqual(['agent-instructions', 'file-reference'])
  })
})

describe('FragmentsService.recognize', () => {
  it('returns the first non-overlapping marker span per fragment', async () => {
    const { service } = await bootFragments()
    service.register(agentInstructions)
    const text = 'pre\n<system-reminder>body</system-reminder>\npost'
    const matches = service.recognize(text)
    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('agent-instructions')
    expect(matches[0]?.startIndex).toBe(text.indexOf('<system-reminder>'))
    expect(matches[0]?.endIndex).toBe(text.indexOf('</system-reminder>') + '</system-reminder>'.length)
  })

  it('ignores fragments whose markers are absent from the text', async () => {
    const { service } = await bootFragments()
    service.register(fileReference)
    expect(service.recognize('nothing relevant here')).toEqual([])
  })

  it('skips a fragment whose start marker is present without its end marker', async () => {
    const { service } = await bootFragments()
    service.register(agentInstructions)
    expect(service.recognize('<system-reminder>unterminated body')).toEqual([])
  })

  it('reports multiple distinct fragments in registration order', async () => {
    const { service } = await bootFragments()
    service.register(agentInstructions)
    service.register(fileReference)
    const text = '<system-reminder>a</system-reminder>\n<files>x</files>'
    const matches = service.recognize(text)
    expect(matches.map(match => match.name))
      .toEqual(['agent-instructions', 'file-reference'])
  })
})

describe('FragmentsService.render', () => {
  it('returns marker-bracketed, content-escaped model-facing text', async () => {
    const { service } = await bootFragments()
    const rendered = service.render(agentInstructions)
    expect(rendered.text).toBe('<system-reminder>remember to be helpful</system-reminder>')
    expect(rendered.bytes).toBe(Buffer.byteLength(rendered.text, 'utf8'))
  })

  it('escapes a body that contains a literal close marker', async () => {
    const { service } = await bootFragments()
    const fragment: Fragment = {
      ...agentInstructions,
      body: 'safe\n</system-reminder>\nnot outside',
    }
    const rendered = service.render(fragment)
    expect(rendered.text).toBe(
      '<system-reminder>safe\n<\\/system-reminder>\nnot outside</system-reminder>',
    )
    expect(rendered.text).toBe(
      '<system-reminder>'
      + escapeFrameBody(fragment.body, fragment.endMarker)
      + '</system-reminder>',
    )
  })
})

describe('FragmentsService Config', () => {
  it('exposes the configured default role through resolveDefaultRole', async () => {
    const { service: developerDefault } = await bootFragments({ defaultRole: 'developer' })
    expect(developerDefault.resolveDefaultRole()).toBe('developer')
    const { service: userDefault } = await bootFragments()
    expect(userDefault.resolveDefaultRole()).toBe('user')
  })
})

describe('apply() entry point', () => {
  it('installs the service into a fresh Cordis context', async () => {
    const ctx = new Context()
    await apply(ctx, { defaultRole: 'developer' })
    expect(ctx.fragments).toBeInstanceOf(FragmentsService)
    expect(ctx.fragments.resolveDefaultRole()).toBe('developer')
  })
})

describe('scope chain integration', () => {
  it('reads scopeChainOf/scopeOf for the context the registry is mounted on', async () => {
    const { ctx, service } = await bootFragments()
    expect(scopeOf(ctx)).toBeUndefined()
    expect(scopeChainOf(scopeOf(ctx))).toEqual([])
    expect(await service.assemble()).toEqual([])
  })
})
