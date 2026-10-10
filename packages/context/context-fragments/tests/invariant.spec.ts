/**
 * Tests for the Step 2 invariant companion. The companion owns the
 * cross-layer validation: per-layer duplicates and marker collisions are
 * caught at `register` time and never reach the assembled waterfall.
 *
 * The test filename matches the manual-invariant convention, which exempts
 * it from the global invariant host; the invariants service is mounted by
 * hand so the companion has a host to register against.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { FragmentsService } from '../src/registry.ts'
import type { FragmentName } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'

const agentInstructions = {
  name: 'agent-instructions' as FragmentName,
  role: 'developer' as const,
  startMarker: '<system-reminder>',
  endMarker: '</system-reminder>',
  order: 0,
  body: 'a',
}

async function bootHost(): Promise<{ ctx: Context; dispose: () => void }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(FragmentsService)
  const dispose = await applyInvariant(ctx)
  return { ctx, dispose }
}

describe('fragments invariant companion', () => {
  it('returns a disposer that can be invoked without error', async () => {
    const { dispose } = await bootHost()
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('passes the empty global assembly without failure', async () => {
    const { ctx, dispose } = await bootHost()
    expect(await ctx.fragments.assemble()).toEqual([])
    dispose()
  })

  it('passes a single registered fragment without failure', async () => {
    const { ctx, dispose } = await bootHost()
    ctx.fragments.register(agentInstructions)
    expect(await ctx.fragments.assemble()).toHaveLength(1)
    dispose()
  })
})
