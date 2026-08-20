/**
 * Normalize the representations used for enabled HTML boolean attributes.
 * An empty string is the native serialized form (for example, autoplay="").
 */
export function isEnabledHtmlBooleanAttribute(value: unknown): boolean {
  return value === true || value === '' || value === 'true';
}
