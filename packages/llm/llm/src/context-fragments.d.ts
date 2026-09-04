/**
 * Step 1 declaration-merge stub for `MessageSourceMap`. This file documents
 * the future `'context-fragments'` source kind and reserves its discriminant
 * via interface declaration merging. The merge is not yet consumed; Steps 2
 * and 3 own the registry-side `assemble()` and the durable row shape that
 * reference this kind. Nothing imports from this file today.
 *
 * Stage: proposed - dsh context-fragments seam Agent Note
 *        (.agents/notes/proposed/feature/2026-09-03-dsh-context-fragments.md)
 *   and four-step decomposition
 *        (.agents/notes/proposed/feature/2026-09-04-dsh-context-fragments-implementation-steps.md)
 */

import type { MessageSourceMap } from './message.ts'

declare module './message.ts' {
  interface MessageSourceMap {
    /**
     * One rendered context fragment. The full surface (named sections,
     * assembled text, marker pair, role) lands in Step 3; this stub keeps
     * only the discriminant and the role split so downstream consumers that
     * switch on `source.kind` can already handle `'context-fragments'`.
     */
    'context-fragments': {
      readonly kind: 'context-fragments'
      readonly role: 'developer' | 'user'
    }
  }
}
