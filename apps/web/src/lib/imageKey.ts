/**
 * Cache key for an image data: URL — its length plus its tail.
 *
 * Deliberately not the whole string: a Map keyed on full data URLs pins
 * megabytes of base64 per entry for the tab's lifetime, long after the layer
 * that owned it is gone. Length + tail collides only for two images of
 * identical byte length sharing their last 40 base64 chars, which for the
 * caches here (alpha detection, mask stencils) costs at worst one wrong
 * memo — never data loss.
 */
export function imageKey(src: string): string {
  return `${src.length}:${src.slice(-40)}`;
}
