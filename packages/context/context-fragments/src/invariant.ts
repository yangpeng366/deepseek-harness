/**
 * Package-owned invariants for the fragment registry. Runs after every
 * `fragments/assemble` waterfall result to catch cross-layer issues the
 * per-layer insertion check cannot see: cross-layer duplicate names that
 * shadow cleanly but leave the global invisible, and cross-layer marker
 * collisions that only manifest when the layer chain is assembled.
 *
 * @module @deepseek-ai/dsh-context-fragments/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Fragment } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-context-fragments'

/** Cordis companion plugin name. */
export const name = 'context-fragments-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the post-waterfall fragment assembly. */
function validateAssembly(fragments: readonly Fragment[], fail: InvariantFailure): void {
  const seenNames = new Set<string>()
  const seenMarkers = new Map<string, string>()
  for (const fragment of fragments) {
    if (fragment.name === '' as unknown as string) {
      fail('assembled fragment names must be non-empty')
    }
    if (seenNames.has(fragment.name)) {
      fail(`assembled fragment name ${JSON.stringify(fragment.name)} is duplicated`)
    }
    seenNames.add(fragment.name)
    if (fragment.startMarker === '' || fragment.endMarker === '') {
      fail(`assembled fragment ${JSON.stringify(fragment.name)} carries an empty marker`)
    }
    if (fragment.startMarker === fragment.endMarker) {
      fail(`assembled fragment ${JSON.stringify(fragment.name)} has identical start and end markers`)
    }
    const markerKey = `${fragment.startMarker}\u0000${fragment.endMarker}`
    const previousHolder = seenMarkers.get(markerKey)
    if (previousHolder !== undefined && previousHolder !== fragment.name) {
      fail(`assembled fragment ${JSON.stringify(fragment.name)} collides with ${JSON.stringify(previousHolder)} on marker pair ${JSON.stringify(fragment.startMarker)}/${JSON.stringify(fragment.endMarker)}`)
    }
    seenMarkers.set(markerKey, fragment.name)
  }
}

/** Install validation around the authoritative assembly waterfall result. */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('fragments/assemble', async (_fragments, _context, next) => {
    const assembled = await next()
    validateAssembly(assembled, fail)
    return assembled
  }, { global: true, prepend: true })
}

/**
 * Register the fragments invariant companion.
 * @param ctx - Cordis context carrying the invariants and fragments services.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
