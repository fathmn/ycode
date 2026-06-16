import 'server-only';

import { unstable_cache } from 'next/cache';
import { fetchGoogleFontsCss } from '@/lib/font-utils';

/**
 * Inlines resolved Google Fonts @font-face CSS for the initial HTML.
 * Only NON-EMPTY results are cached forever; failures (empty string) throw so
 * unstable_cache does not persist them, making the slow runtime-stylesheet
 * fallback transient/self-healing instead of permanently frozen.
 * Cache key is versioned (v2) to bypass previously poisoned empty entries.
 */
export async function getInlinedGoogleFontsCss(urls: string[]): Promise<string> {
  if (urls.length === 0) return '';

  return unstable_cache(
    async () => {
      const css = await fetchGoogleFontsCss(urls);
      if (!css) throw new Error('google-fonts-inline-empty');
      return css;
    },
    [`google-fonts-css-v2-${urls.join('|')}`],
    { tags: ['all-pages'], revalidate: false },
  )().catch(() => '');
}
