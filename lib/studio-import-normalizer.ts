import type { Layer, LinkSettings } from '@/types';
import { cleanImportDesign, styleToClasses } from '@/lib/html-layer-converter';
import { classesToDesign, mergeDesign, propertyToClass, replaceConflictingClasses } from '@/lib/tailwind-class-mapper';

export interface StudioImportPageTarget {
  id: string;
  route: string;
}

export interface StudioImportNormalizationStats {
  layersVisited: number;
  linksNormalized: number;
  inlineStylesConverted: number;
  inlineStyleDeclarationsRemoved: number;
  classesAdded: number;
  designObjectsAdded: number;
}

export interface StudioImportNormalizationResult {
  layers: Layer[];
  stats: StudioImportNormalizationStats;
  changed: boolean;
}

const EMPTY_STATS: StudioImportNormalizationStats = {
  layersVisited: 0,
  linksNormalized: 0,
  inlineStylesConverted: 0,
  inlineStyleDeclarationsRemoved: 0,
  classesAdded: 0,
  designObjectsAdded: 0,
};

function cloneStats(): StudioImportNormalizationStats {
  return { ...EMPTY_STATS };
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed || trimmed === '/') return '/';
  const [withoutHash] = trimmed.split('#');
  const [withoutQuery] = withoutHash.split('?');
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

function pageTargetMap(pageTargets: StudioImportPageTarget[] | undefined): Map<string, StudioImportPageTarget> {
  const map = new Map<string, StudioImportPageTarget>();
  for (const page of pageTargets || []) {
    if (!page.id) continue;
    map.set(normalizeRoute(page.route || '/'), page);
  }
  return map;
}

function resolveHref(rawHref: unknown): URL | null {
  if (typeof rawHref !== 'string') return null;
  const href = rawHref.trim();
  if (!href) return null;

  try {
    return new URL(href, 'https://studio-import.local');
  } catch {
    return null;
  }
}

function isInternalRouteUrl(url: URL): boolean {
  return url.origin === 'https://studio-import.local'
    || url.hostname === 'studio.novum-partners.de'
    || url.hostname.endsWith('.vercel.app');
}

function existingLinkMatchesRawHref(link: LinkSettings | null | undefined, rawHref: string): boolean {
  if (!link?.type) return false;
  if (link.type !== 'url') return true;
  return link.url?.data?.content !== rawHref;
}

function linkSettingsFromHref(
  rawHref: unknown,
  routeTargets: Map<string, StudioImportPageTarget>,
  attributes: Record<string, any>,
): LinkSettings | null {
  if (typeof rawHref !== 'string') return null;
  const href = rawHref.trim();
  if (!href) return null;

  const target = typeof attributes.target === 'string' ? attributes.target as LinkSettings['target'] : undefined;
  const rel = typeof attributes.rel === 'string' ? attributes.rel : undefined;

  if (href.startsWith('mailto:')) {
    return {
      type: 'email',
      email: { type: 'dynamic_text', data: { content: href.replace(/^mailto:/i, '') } },
      ...(target ? { target } : {}),
      ...(rel ? { rel } : {}),
    };
  }

  if (href.startsWith('tel:')) {
    return {
      type: 'phone',
      phone: { type: 'dynamic_text', data: { content: href.replace(/^tel:/i, '') } },
      ...(target ? { target } : {}),
      ...(rel ? { rel } : {}),
    };
  }

  const url = resolveHref(href);
  if (url && isInternalRouteUrl(url) && !url.search) {
    const pageTarget = routeTargets.get(normalizeRoute(url.pathname));
    if (pageTarget && !url.hash) {
      return {
        type: 'page',
        page: { id: pageTarget.id, collection_item_id: null },
        anchor_layer_id: null,
        ...(target ? { target } : {}),
        ...(rel ? { rel } : {}),
      };
    }
  }

  return {
    type: 'url',
    url: { type: 'dynamic_text', data: { content: href } },
    ...(target ? { target } : {}),
    ...(rel ? { rel } : {}),
  };
}

function splitStyleDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = '';
  let parenDepth = 0;
  let quote: string | null = null;

  for (const char of style) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') parenDepth += 1;
    if (char === ')' && parenDepth > 0) parenDepth -= 1;

    if (char === ';' && parenDepth === 0) {
      if (current.trim()) declarations.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) declarations.push(current.trim());
  return declarations;
}

function normalizeClassList(classes: Layer['classes'] | undefined): string[] {
  if (Array.isArray(classes)) return classes.filter(Boolean);
  if (typeof classes !== 'string') return [];
  return classes.split(/\s+/).filter(Boolean);
}

function repairLegacyInvalidImportClasses(layer: Layer): { classes: string; changed: boolean; addedCount: number } {
  const classes = normalizeClassList(layer.classes);
  if (classes.length === 0) return { classes: typeof layer.classes === 'string' ? layer.classes : '', changed: false, addedCount: 0 };

  let changed = false;
  let addedCount = 0;
  let repaired = classes.filter((cls) => {
    const isInvalidTextFunction = /^text-(?:clamp|calc|var|min|max|fit)-?\(/.test(cls) || /^text-var\(/.test(cls);
    const isInvalidIntrinsicWidth = /^(?:w|min-w|max-w|h|min-h|max-h)-(?:min-content|max-content|fit-content)$/.test(cls);
    const isInvalidGapFunction = /^gap-(?:clamp|calc|var)\(/.test(cls);

    if (isInvalidTextFunction || isInvalidIntrinsicWidth || isInvalidGapFunction) {
      changed = true;
      return false;
    }
    return true;
  });

  const addDesignClass = (
    category: keyof NonNullable<Layer['design']>,
    property: string,
    value: unknown,
  ) => {
    if (typeof value !== 'string' || !value) return;
    const cls = propertyToClass(category, property, value);
    if (!cls) return;
    const before = repaired.length;
    repaired = replaceConflictingClasses(repaired, property, cls);
    if (repaired.length > before || !repaired.includes(cls)) addedCount += 1;
    changed = true;
  };

  addDesignClass('typography', 'fontSize', layer.design?.typography?.fontSize);
  addDesignClass('typography', 'color', layer.design?.typography?.color);
  addDesignClass('layout', 'gap', layer.design?.layout?.gap);
  addDesignClass('sizing', 'width', layer.design?.sizing?.width);
  addDesignClass('sizing', 'height', layer.design?.sizing?.height);
  addDesignClass('sizing', 'minWidth', layer.design?.sizing?.minWidth);
  addDesignClass('sizing', 'minHeight', layer.design?.sizing?.minHeight);
  addDesignClass('sizing', 'maxWidth', layer.design?.sizing?.maxWidth);
  addDesignClass('sizing', 'maxHeight', layer.design?.sizing?.maxHeight);

  return {
    classes: repaired.join(' '),
    changed,
    addedCount,
  };
}

function mergeClassList(existing: Layer['classes'] | undefined, additions: string[]): { classes: string; addedCount: number } {
  const merged = new Set(normalizeClassList(existing));
  let addedCount = 0;

  for (const cls of additions) {
    if (!cls || merged.has(cls)) continue;
    merged.add(cls);
    addedCount += 1;
  }

  return { classes: Array.from(merged).join(' '), addedCount };
}

function normalizeInlineStyle(
  attributes: Record<string, any>,
): { nextAttributes: Record<string, any>; classes: string[]; removedDeclarations: number; changed: boolean } {
  const style = attributes.style;
  if (typeof style !== 'string' || !style.trim()) {
    return { nextAttributes: attributes, classes: [], removedDeclarations: 0, changed: false };
  }

  const retainedDeclarations: string[] = [];
  const classes: string[] = [];
  let removedDeclarations = 0;

  for (const declaration of splitStyleDeclarations(style)) {
    const mappedClasses = styleToClasses(declaration);
    if (mappedClasses.length > 0) {
      classes.push(...mappedClasses);
      removedDeclarations += 1;
      continue;
    }
    retainedDeclarations.push(declaration);
  }

  if (removedDeclarations === 0) {
    return { nextAttributes: attributes, classes, removedDeclarations, changed: false };
  }

  const nextAttributes = { ...attributes };
  if (retainedDeclarations.length > 0) {
    nextAttributes.style = retainedDeclarations.join('; ');
  } else {
    delete nextAttributes.style;
  }

  return { nextAttributes, classes, removedDeclarations, changed: true };
}

function removeRawLinkAttributesForNormalizedLink(
  attributes: Record<string, any>,
  link: LinkSettings | null | undefined,
): { attributes: Record<string, any>; changed: boolean } {
  if (!link?.type) return { attributes, changed: false };

  const nextAttributes = { ...attributes };
  let changed = false;

  for (const attribute of ['href', 'target', 'rel', 'download']) {
    if (attribute in nextAttributes) {
      delete nextAttributes[attribute];
      changed = true;
    }
  }

  return { attributes: nextAttributes, changed };
}

function normalizeLayer(
  layer: Layer,
  routeTargets: Map<string, StudioImportPageTarget>,
  stats: StudioImportNormalizationStats,
): { layer: Layer; changed: boolean } {
  stats.layersVisited += 1;

  let changed = false;
  let nextLayer: Layer = { ...layer };
  let nextAttributes = { ...(layer.attributes || {}) };

  const classRepair = repairLegacyInvalidImportClasses(nextLayer);
  if (classRepair.changed) {
    nextLayer = {
      ...nextLayer,
      classes: classRepair.classes,
    };
    stats.classesAdded += classRepair.addedCount;
    changed = true;
  }

  const rawHref = nextAttributes.href;
  const currentLink = nextLayer.variables?.link as LinkSettings | null | undefined;
  const shouldNormalizeLink = typeof rawHref === 'string'
    && (!currentLink?.type || !existingLinkMatchesRawHref(currentLink, rawHref));

  if (shouldNormalizeLink) {
    const link = linkSettingsFromHref(rawHref, routeTargets, nextAttributes);
    if (link) {
      nextLayer = {
        ...nextLayer,
        variables: {
          ...(nextLayer.variables || {}),
          link,
        },
      };
      nextAttributes = removeRawLinkAttributesForNormalizedLink(nextAttributes, link).attributes;
      stats.linksNormalized += 1;
      changed = true;
    }
  }

  const cleanedLinkAttributes = removeRawLinkAttributesForNormalizedLink(
    nextAttributes,
    nextLayer.variables?.link as LinkSettings | null | undefined,
  );
  if (cleanedLinkAttributes.changed) {
    nextAttributes = cleanedLinkAttributes.attributes;
    changed = true;
  }

  const styleNormalization = normalizeInlineStyle(nextAttributes);
  if (styleNormalization.changed) {
    nextAttributes = styleNormalization.nextAttributes;
    stats.inlineStylesConverted += 1;
    stats.inlineStyleDeclarationsRemoved += styleNormalization.removedDeclarations;

    const mergedClasses = mergeClassList(nextLayer.classes, styleNormalization.classes);
    nextLayer = {
      ...nextLayer,
      classes: mergedClasses.classes,
    };
    stats.classesAdded += mergedClasses.addedCount;

    const designFromInlineStyle = cleanImportDesign(classesToDesign(styleNormalization.classes));
    if (designFromInlineStyle) {
      nextLayer = {
        ...nextLayer,
        design: cleanImportDesign(mergeDesign(nextLayer.design, designFromInlineStyle)),
      };
      stats.designObjectsAdded += 1;
    }
    changed = true;
  }

  nextLayer = { ...nextLayer, attributes: nextAttributes };

  if (nextLayer.children?.length) {
    const normalizedChildren = nextLayer.children.map((child) => normalizeLayer(child, routeTargets, stats));
    if (normalizedChildren.some((child) => child.changed)) {
      nextLayer = {
        ...nextLayer,
        children: normalizedChildren.map((child) => child.layer),
      };
      changed = true;
    }
  }

  return { layer: nextLayer, changed };
}

export function normalizeStudioImportLayers(
  layers: Layer[],
  pageTargets?: StudioImportPageTarget[],
): StudioImportNormalizationResult {
  const stats = cloneStats();
  const routeTargets = pageTargetMap(pageTargets);
  const normalizedLayers = layers.map((layer) => normalizeLayer(layer, routeTargets, stats));

  return {
    layers: normalizedLayers.map((item) => item.layer),
    stats,
    changed: normalizedLayers.some((item) => item.changed),
  };
}
