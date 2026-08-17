/**
 * Setting keys that must never take part in a draft fingerprint.
 *
 * `published_at` is publish bookkeeping. `draft_css` and `published_css` are
 * machine-generated from the layer tree — and the layer tree is fingerprinted
 * on its own, so hashing the generated CSS adds no coverage. It does add harm:
 * the builder regenerates and rewrites `draft_css` whenever the editor loads or
 * a style changes, which moved the fingerprint underneath the preview-approval
 * gate. A freshly approved draft was already stale by the time Publish ran, so
 * live publishing failed with `STUDIO_PREVIEW_REQUIRED` / "Open this Studio
 * preview again" and could not be recovered from the UI.
 *
 * Both fingerprint producers MUST use this list:
 *   - `proxy.ts` → `computeDraftFingerprint()` mints the preview nonce
 *   - `lib/studio-platform.ts` → `getCurrentDraftFingerprint()` /
 *     `getCurrentDraftHash()` verify the nonce, the approval and the publish
 * If the two lists ever drift apart, the nonce fingerprint can never match the
 * verifying one and publishing is blocked permanently.
 */
export const DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS = [
  'published_at',
  'draft_css',
  'published_css',
] as const;

/**
 * Value for a PostgREST `not('key', 'in', ...)` filter, e.g.
 * `("published_at","draft_css","published_css")`.
 */
export const DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS_FILTER = `(${
  DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS.map((key) => `"${key}"`).join(',')
})`;
