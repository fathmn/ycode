export interface PublishedImagePreload {
  href: string;
  imageSrcSet?: string;
  imageSizes?: string;
}

const IMG_TAG_REGEX = /<img\b[^>]*>/gi;
const ATTRIBUTE_REGEX = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_REGEX.exec(tag)) !== null) {
    const key = match[1]?.toLowerCase();
    if (!key || key === 'img') continue;
    attrs[key] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
  }

  return attrs;
}

export function extractPriorityImagePreload(html: string): PublishedImagePreload | null {
  IMG_TAG_REGEX.lastIndex = 0;

  let fallbackEagerImage: PublishedImagePreload | null = null;
  let match: RegExpExecArray | null;

  while ((match = IMG_TAG_REGEX.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const href = attrs.src;
    if (!href) continue;

    const preload: PublishedImagePreload = {
      href,
      imageSrcSet: attrs.srcset || undefined,
      imageSizes: attrs.sizes || undefined,
    };

    if (attrs.fetchpriority === 'high') {
      return preload;
    }

    if (!fallbackEagerImage && attrs.loading === 'eager' && !attrs['data-studio-brand-logo']) {
      fallbackEagerImage = preload;
    }
  }

  return fallbackEagerImage;
}
