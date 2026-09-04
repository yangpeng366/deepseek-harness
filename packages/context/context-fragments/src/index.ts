/**
 * Typed request-context fragments shared by `packages/context/` contributors.
 *
 * Step 1 ships the value types and the shared escape; `ctx.fragments.*` and
 * the durable source kind arrive in Steps 2 and 3.
 *
 * @module @deepseek-ai/dsh-context-fragments
 */

export {
  escapeFrameBody,
  escapeInstructionFrameBody,
} from './escape.ts'

/** The two roles a fragment can occupy in a model request. */
export type FragmentRole = 'developer' | 'user'

/** Stable identity for one registered fragment within its layer. */
export type FragmentName = string & { readonly __fragmentName: unique symbol }

/**
 * One typed contribution to a request context. A fragment owns its open marker,
 * its close marker, the body it contributes, and the order it assembles in
 * relative to its siblings. `role` distinguishes content the model should
 * treat as authoritative direction from content that originated as a user
 * prompt and may be paraphrased or quoted.
 *
 * Markers are owned by the registry, not by the contributor: two fragments
 * in one layer cannot share a non-empty start or end marker. Recognition is
 * content-blind, so partial matches do not count; the literal substring
 * `marker` in the rendered body is what `recognize()` later keys on.
 *
 * @typeParam Body - the contributor's body shape. The registry treats it as
 *   an opaque string for the purpose of escape and recognition; richer
 *   shapes arrive when the contributor serializes its own body in Step 3.
 */
export interface Fragment<Body extends string = string> {
  readonly name: FragmentName
  readonly role: FragmentRole
  readonly startMarker: string
  readonly endMarker: string
  readonly order: number
  readonly body: Body
}

/**
 * One fragment rendered to model-facing text. The contributor's markers are
 * concatenated with the escaped body without injected whitespace so a
 * contributor that needs separators owns them in `body`.
 */
export interface RenderedFragment {
  readonly name: FragmentName
  readonly role: FragmentRole
  readonly order: number
  /** Marker-bracketed, content-escaped model-facing text. */
  readonly text: string
  /** Byte length of `text` under UTF-8. */
  readonly bytes: number
}

/**
 * One recognized fragment, returned by `recognize()` when a previously
 * injected fragment's markers bracket a span of persisted text. The matched
 * range is `[startIndex, endIndex]` over `text`; callers should treat the
 * matched slice as opaque until they re-invoke `recognize()` themselves.
 */
export interface FragmentMatch {
  readonly name: FragmentName
  readonly startIndex: number
  readonly endIndex: number
}
