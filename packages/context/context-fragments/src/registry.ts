/**
 * Cordis-backed registry for typed request-context fragments.
 *
 * Step 2 of the four-step implementation plan. The registry owns per-scope
 * fragment layers, exposes `register` / `assemble` / `recognize`, and emits
 * `fragments/change` after every successful registration or removal. Scope
 * rules mirror `system-prompt`: global contributions plus scope-keyed
 * overlays, nearest scope shadowing, and the exact Cordis effect disposer
 * as the return value.
 *
 * Marker collision and duplicate names within one layer fail loud here, so
 * the invariant companion only has to defend against cross-layer collisions
 * that the layer itself cannot see. Recognition is content-blind and uses
 * the literal marker substring; the persistent-text scan is a non-overlapping
 * match per registered fragment in the active scope chain.
 *
 * @module @deepseek-ai/dsh-context-fragments/registry
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import {
  NamedEntries,
  ScopedLayers,
  scopeOf,
  scopeTarget,
} from '@deepseek-ai/dsh-scope'
import type { ScopeKey, ScopeLayer, Scoped } from '@deepseek-ai/dsh-scope'
import { escapeFrameBody } from './escape.ts'
import type {
  Fragment,
  FragmentMatch,
  FragmentName,
  RenderedFragment,
} from './index.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fragments: FragmentsService
  }

  interface Events {
    /**
     * Expert waterfall over the assembled fragments at one scope. The
     * returned array is authoritative; listeners may reorder or rewrite
     * fragments but must preserve each fragment's marker pair so
     * `recognize()` stays consistent with `register()`. Scope-filtered
     * dispatch (`@deepseek-ai/dsh-scope`): scoped listeners receive only
     * that scope's assemblies.
     * @param fragments - the fragments merged across the scope chain.
     * @param context - the caller's per-assembly scope key.
     * @mode waterfall
     */
    'fragments/assemble'(this: Scoped<FragmentsService>, fragments: readonly Fragment[], context: FragmentsAssembleContext, next: () => Promise<readonly Fragment[]>): Promise<readonly Fragment[]>
    /**
     * Emitted after any fragment registration or removal. This registry
     * notification is unfiltered because a global change affects every scope.
     * @mode emit
     */
    'fragments/change'(): void
  }
}

/** Merge-extensible context for one fragment assembly. */
export interface FragmentsAssembleContext {
  /**
   * Scope whose layers and waterfall listeners participate. When absent,
   * only the global layer and subject-less listeners participate.
   */
  scope?: ScopeKey
}

/** Validator-friendly shape for {@link FragmentsService.Config}. */
export interface FragmentsConfig {
  /**
   * Fallback role assigned when a contributor omits one. Default: `'user'`.
   * The fallback never overrides an explicit role on a fragment.
   */
  defaultRole?: 'developer' | 'user'
}

/** One scope's aggregate fragment registrations. */
class FragmentsLayer implements ScopeLayer {
  readonly fragments: NamedEntries<Fragment>

  /**
   * Marker pairs reserved by this layer's registrations. The key format is
   * `${startMarker}\u0000${endMarker}` so non-empty starts or ends collide
   * across fragments within one layer, regardless of whether the contributor
   * supplied a paired or an open/close single side. Empty markers never enter
   * the map because the registry rejects them upstream.
   */
  private readonly reservedMarkers = new Map<string, FragmentName>()

  constructor(scope: ScopeKey | undefined) {
    this.fragments = new NamedEntries<Fragment>((name: string) => new Error(scope === undefined
      ? `fragments: fragment "${name}" is already registered (for a per-scope override, register through that scope)`
      : `fragments: fragment "${name}" is already registered in this scope`))
  }

  /**
   * Insert one unique fragment after validating marker uniqueness in this
   * layer.
   * @param fragment - the fragment to retain.
   * @returns an idempotent undo that removes both the fragment and its
   *   marker reservation.
   */
  insert(fragment: Fragment): () => void {
    const remove = this.fragments.insert(fragment.name, fragment)
    const markerKey = markerPairKey(fragment.startMarker, fragment.endMarker)
    const previousHolder = this.reservedMarkers.get(markerKey)
    if (previousHolder !== undefined) {
      remove()
      throw new Error(`fragments: marker pair ${JSON.stringify(fragment.startMarker)}/${JSON.stringify(fragment.endMarker)} is already reserved by "${previousHolder}" (offender "${fragment.name}")`)
    }
    this.reservedMarkers.set(markerKey, fragment.name)
    return () => {
      remove()
      this.reservedMarkers.delete(markerKey)
    }
  }

  isEmpty(): boolean {
    return this.fragments.isEmpty()
  }
}

/** Compose a stable key for a fragment's marker pair. */
function markerPairKey(startMarker: string, endMarker: string): string {
  return `${startMarker}\u0000${endMarker}`
}

/** Cordis service that owns fragment registration, assembly, and recognition. */
export class FragmentsService extends Service {
  private readonly layers = new ScopedLayers<FragmentsLayer>(
    scope => new FragmentsLayer(scope),
    () => { this.ctx.emit('fragments/change') },
  )

  /** Fallback role used when a contributor omits one. Resolved at construction. */
  private readonly defaultRole: 'developer' | 'user'

  constructor(ctx: Context, config: FragmentsConfig = {}) {
    super(ctx, 'fragments')
    this.defaultRole = config.defaultRole ?? 'user'
  }

  /**
   * Register one fragment in the calling context's scope. Scoped fragments
   * shadow globals with the same name; duplicates within one layer and
   * collisions on the marker pair throw. Registration and disposal emit
   * `fragments/change`.
   * @param fragment - the fragment to register.
   * @returns the exact Cordis effect disposer.
   */
  register(fragment: Fragment): () => void {
    if (!Number.isFinite(fragment.order)) {
      throw new TypeError(`fragments: fragment "${fragment.name}" order must be a finite number`)
    }
    if (fragment.startMarker === '' || fragment.endMarker === '') {
      throw new Error(`fragments: fragment "${fragment.name}" markers must be non-empty (start=${JSON.stringify(fragment.startMarker)}, end=${JSON.stringify(fragment.endMarker)})`)
    }
    if (fragment.startMarker === fragment.endMarker) {
      throw new Error(`fragments: fragment "${fragment.name}" start and end markers must differ`)
    }
    return this.layers.effect(
      this.ctx,
      layer => layer.insert(fragment),
      { label: 'fragments.register()' },
    )
  }

  /**
   * Merge global and scoped fragments, apply canonical ordering, and run the
   * assembly waterfall. The returned array is authoritative.
   * @param context - the optional scope key for the assembly.
   * @returns the post-waterfall fragments in render order.
   */
  async assemble(context: FragmentsAssembleContext = {}): Promise<readonly Fragment[]> {
    const merged = new Map<string, Fragment>()
    for (const [name, fragment] of this.layers.global.fragments.entries()) {
      merged.set(name, fragment)
    }
    for (const layer of this.layers.chainLayers(context.scope)) {
      for (const [name, fragment] of layer.fragments.entries()) merged.set(name, fragment)
    }
    const ordered = [...merged.values()].sort((a, b) => a.order - b.order)
    return this.ctx.waterfall(
      scopeTarget(this, scopeOf(this.ctx)),
      'fragments/assemble',
      ordered,
      context,
      () => Promise.resolve(ordered),
    )
  }

  /**
   * Scan `text` for the registered marker spans in `scope`. Each fragment
   * contributes at most one match: the first non-overlapping occurrence of
   * `startMarker` immediately followed by `endMarker` (with no overlap rule
   * between distinct fragments; overlapping candidates are reported in
   * registration order so the result is deterministic).
   * @param text - persisted text to scan; usually a `user/message` body.
   * @param context - the optional scope key for fragment selection.
   * @returns the recognized fragments with their half-open ranges.
   */
  recognize(text: string, context: FragmentsAssembleContext = {}): readonly FragmentMatch[] {
    const ordered = [...this.layers.global.fragments.values()]
    for (const layer of this.layers.chainLayers(context.scope)) {
      for (const fragment of layer.fragments.values()) {
        const existing = ordered.findIndex(candidate => candidate.name === fragment.name)
        if (existing >= 0) ordered[existing] = fragment
        else ordered.push(fragment)
      }
    }
    ordered.sort((a, b) => a.order - b.order)
    const matches: FragmentMatch[] = []
    for (const fragment of ordered) {
      const startIndex = text.indexOf(fragment.startMarker)
      if (startIndex < 0) continue
      const bodyStart = startIndex + fragment.startMarker.length
      const endIndex = text.indexOf(fragment.endMarker, bodyStart)
      if (endIndex < 0) continue
      matches.push({ name: fragment.name, startIndex, endIndex: endIndex + fragment.endMarker.length })
    }
    return matches
  }

  /**
   * Render one fragment to model-facing text. The helper concatenates the
   * markers and the escaped body without injected whitespace so a contributor
   * that needs separators owns them in `body`.
   * @param fragment - the fragment to render.
   * @returns the rendered text plus its UTF-8 byte length.
   */
  render(fragment: Fragment): RenderedFragment {
    const escapedBody = escapeFrameBody(fragment.body, fragment.endMarker)
    const text = fragment.startMarker + escapedBody + fragment.endMarker
    return {
      name: fragment.name,
      role: fragment.role,
      order: fragment.order,
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
    }
  }

  /**
   * Read the fallback role the service was configured with.
   * @returns the configured default role.
   */
  resolveDefaultRole(): 'developer' | 'user' {
    return this.defaultRole
  }
}
