/**
 * Compile-time guarantees for the Step 1 value-type surface. The behaviors
 * exercised here are not yet runtime-checked because Steps 2 and 3 own the
 * registry and the durable source kind; the assertions pin only the shape
 * the registry will rely on.
 */

import { describe, expectTypeOf, it } from 'vitest'
import type {
  Fragment,
  FragmentMatch,
  FragmentName,
  FragmentRole,
  RenderedFragment,
} from '@deepseek-ai/dsh-context-fragments'

describe('Fragment<Body> shape', () => {
  it('accepts role, markers, order, and a string body', () => {
    const fragment: Fragment = {
      name: 'agent-instructions' as FragmentName,
      role: 'developer',
      startMarker: '<system-reminder>',
      endMarker: '</system-reminder>',
      order: 0,
      body: 'instructions',
    }
    expectTypeOf(fragment).toEqualTypeOf<Fragment>()
    expectTypeOf(fragment.role).toEqualTypeOf<FragmentRole>()
  })

  it('rejects a role outside the developer/user union at compile time', () => {
    const bad: Fragment = {
      name: 'agent-instructions' as FragmentName,
      // @ts-expect-error role must be 'developer' or 'user'
      role: 'assistant',
      startMarker: '<system-reminder>',
      endMarker: '</system-reminder>',
      order: 0,
      body: 'instructions',
    }
    expectTypeOf(bad).toEqualTypeOf<Fragment>()
  })
})

describe('RenderedFragment and FragmentMatch', () => {
  it('exposes text and bytes on the rendered form', () => {
    expectTypeOf<RenderedFragment['text']>().toBeString()
    expectTypeOf<RenderedFragment['bytes']>().toBeNumber()
    expectTypeOf<RenderedFragment['order']>().toBeNumber()
    expectTypeOf<RenderedFragment['role']>().toEqualTypeOf<FragmentRole>()
  })

  it('exposes a half-open range on the match form', () => {
    expectTypeOf<FragmentMatch['startIndex']>().toBeNumber()
    expectTypeOf<FragmentMatch['endIndex']>().toBeNumber()
  })
})
