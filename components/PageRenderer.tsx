import { Fragment } from 'react';
import AnimationInitializer from '@/components/AnimationInitializer';
import BodyClassApplier from '@/components/BodyClassApplier';
import ContentHeightReporter from '@/components/ContentHeightReporter';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import LayerRendererPublic from '@/components/LayerRendererPublic';
import SliderInitializer from '@/components/SliderInitializer';
import LightboxInitializer from '@/components/LightboxInitializer';
import PasswordForm from '@/components/PasswordForm';
import YcodeBadge from '@/components/YcodeBadge';
import { FORM_RESET_CSS } from '@/components/form-reset-css';
import { unstable_cache } from 'next/cache';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { extractAnimationLayers, generateInitialAnimationCSS, type HiddenLayerInfo } from '@/lib/animation-utils';
import { buildCustomFontsCss, buildFontClassesCss, filterGoogleFontLinksAgainstHeadHtml, getGoogleFontLinks, removeDuplicateGoogleFontLinksFromHeadHtml } from '@/lib/font-utils';
import { buildImageSizes, collectLayerAssetIds, findLcpCandidate, generateImageSrcset, getAssetProxyUrl, getOptimizedImageUrl } from '@/lib/asset-utils';
import { getInlinedGoogleFontsCss } from '@/lib/server/googleFontsInline';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getMapboxAccessToken, getGoogleMapsEmbedApiKey } from '@/lib/map-server';
import { getAllColorVariables } from '@/lib/repositories/colorVariableRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { getItemsWithValues, getItemsWithValuesByIds } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { REF_PAGE_PREFIX, REF_COLLECTION_PREFIX, isCollectionItemKeyword, parseCollectionLinkValue } from '@/lib/link-utils';
import { getClassesString, hasPasswordFormLayer } from '@/lib/layer-utils';
import { buildLocalizedPageUrls, type LocalizedDynamicSlug } from '@/lib/page-utils';
import { getTranslatableKey } from '@/lib/locale-runtime';
import { getTranslationsByLocale } from '@/lib/repositories/translationRepository';
import { parseSafeBodyStyle } from '@/lib/body-style';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { SUPABASE_QUERY_LIMIT } from '@/lib/supabase-constants';
import { castValue } from '@/lib/collection-utils';
import { canRenderStudioCustomCode } from '@/lib/studio-platform';
import type { Layer, Component, Page, CollectionItemWithValues, CollectionField, Locale, PageFolder, Font, ColorVariable, Asset, PasswordProtectionContext, Translation } from '@/types';

interface PageLinkRef { collection_item_id: string; page_id: string }

const getCachedPublishedPages = unstable_cache(
  async () => getAllPages({ is_published: true }),
  ['page-renderer-published-pages'],
  { tags: ['all-pages'], revalidate: false }
);

const getCachedPublishedFolders = unstable_cache(
  async () => getAllPageFolders({ is_published: true }),
  ['page-renderer-published-folders'],
  { tags: ['all-pages'], revalidate: false }
);

/** Recursively collect all page link refs ({collection_item_id, page_id}) from a Tiptap JSON node.
 * Also descends into pre-resolved layers stored on embedded richTextComponent nodes. */
function collectTiptapPageLinks(node: any): PageLinkRef[] {
  if (!node || typeof node !== 'object') return [];
  const results: PageLinkRef[] = [];
  if (node.marks && Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark.type === 'richTextLink' && mark.attrs?.type === 'page'
        && mark.attrs.page?.collection_item_id && mark.attrs.page?.id) {
        results.push({ collection_item_id: mark.attrs.page.collection_item_id, page_id: mark.attrs.page.id });
      }
    }
  }
  // Pre-resolved layers from rich-text-embedded components (set by resolveTiptapComponentCollections)
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)) {
    results.push(...collectLayerPageLinks(node.attrs._resolvedLayers as Layer[]));
  }
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) results.push(...collectTiptapPageLinks(child));
  }
  return results;
}

/**
 * Walk a layer tree and return every page link ref from both layer-level links
 * and richTextLink marks inside rich text variables.
 */
function collectLayerPageLinks(layers: Layer[]): PageLinkRef[] {
  const results: PageLinkRef[] = [];
  const scan = (layer: Layer) => {
    if (layer.variables?.link?.type === 'page') {
      const { collection_item_id, id: page_id } = layer.variables.link.page ?? {};
      if (collection_item_id && page_id) results.push({ collection_item_id, page_id });
    }
    // Field-bound links: extract page refs from pre-resolved link values
    if (layer.variables?.link?.type === 'field') {
      const resolvedValue = layer.variables.link.field?.data?._resolvedValue;
      if (resolvedValue) {
        const linkValue = parseCollectionLinkValue(resolvedValue);
        if (linkValue?.type === 'page' && linkValue.page?.collection_item_id && linkValue.page?.id) {
          results.push({ collection_item_id: linkValue.page.collection_item_id, page_id: linkValue.page.id });
        }
      }
    }
    // Form redirect_url: extract page refs so the target item slug is pre-fetched
    const redirectUrl = layer.settings?.form?.redirect_url;
    if (redirectUrl?.type === 'page') {
      const { collection_item_id, id: page_id } = redirectUrl.page ?? {};
      if (collection_item_id && page_id) results.push({ collection_item_id, page_id });
    }
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content) {
      results.push(...collectTiptapPageLinks(textVar.data.content));
    }
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return results;
}

/** Recursively scan a Tiptap JSON node for richTextComponent nodes and harvest
 * slugs from their pre-resolved layers (populated by resolveTiptapComponentCollections). */
function extractTiptapCollectionItemSlugs(node: any, slugs: Record<string, string>): void {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)) {
    const nested = extractCollectionItemSlugs(node.attrs._resolvedLayers as Layer[]);
    Object.assign(slugs, nested);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) extractTiptapCollectionItemSlugs(child, slugs);
  }
}

/**
 * Extract collection item slugs from resolved collection layers.
 * These are populated by resolveCollectionLayers with `_collectionItemId` / `_collectionItemSlug`.
 * Also descends into pre-resolved layers of rich-text-embedded components so links inside
 * those components (e.g. "current-collection") can be resolved at render time.
 */
function extractCollectionItemSlugs(layers: Layer[]): Record<string, string> {
  const slugs: Record<string, string> = {};
  const scan = (layer: Layer) => {
    if (layer._collectionItemId && layer._collectionItemSlug) {
      slugs[layer._collectionItemId] = layer._collectionItemSlug;
    }
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content) {
      extractTiptapCollectionItemSlugs(textVar.data.content, slugs);
    }
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return slugs;
}

/**
 * Strip heavy SSR-only data from the layer tree before passing to client
 * components. After resolveCollectionLayers, all variables are pre-resolved
 * into the layers — _collectionItemValues and _layerDataMap are redundant
 * and can be enormous (e.g. 50 articles × full rich text bodies).
 *
 * The RSC Flight payload serializes everything passed to 'use client'
 * components, so stripping here avoids doubling the response size.
 */
function stripSSROnlyData(layers: Layer[]): Layer[] {
  return layers.map(layer => {
    const stripped: Layer = { ...layer };

    delete stripped._collectionItemValues;
    delete stripped._collectionItemSlug;
    delete stripped._layerDataMap;

    if (stripped._filterConfig?.layerTemplate) {
      stripped._filterConfig = {
        ...stripped._filterConfig,
        layerTemplate: stripSSROnlyData(stripped._filterConfig.layerTemplate),
      };
    }

    if (stripped._paginationMeta?.layerTemplate) {
      stripped._paginationMeta = {
        ...stripped._paginationMeta,
        layerTemplate: stripSSROnlyData(stripped._paginationMeta.layerTemplate),
      };
    }

    if (stripped.children) {
      stripped.children = stripSSROnlyData(stripped.children);
    }

    return stripped;
  });
}

/** Scan a Tiptap JSON node for richTextComponent nodes and test their pre-resolved
 * layers (populated by resolveTiptapComponentCollections) against the predicate. */
function tiptapTreeHasLayer(node: any, predicate: (layer: Layer) => boolean): boolean {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)
    && layerTreeHasLayer(node.attrs._resolvedLayers as Layer[], predicate)) {
    return true;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (tiptapTreeHasLayer(child, predicate)) return true;
    }
  }
  return false;
}

/** Recursively check if any layer matches the predicate, descending into both
 * children and the pre-resolved layers of rich-text-embedded components. */
function layerTreeHasLayer(layers: Layer[], predicate: (layer: Layer) => boolean): boolean {
  for (const layer of layers) {
    if (predicate(layer)) return true;
    const textVar = layer.variables?.text as any;
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content
      && tiptapTreeHasLayer(textVar.data.content, predicate)) {
      return true;
    }
    if (layer.children && layerTreeHasLayer(layer.children, predicate)) return true;
  }
  return false;
}

/** Check if any layer in the tree (including rich-text-embedded components) is a slider */
function hasSliderLayers(layers: Layer[]): boolean {
  return layerTreeHasLayer(layers, layer => layer.name === 'slider');
}

/** Check if any layer in the tree (including rich-text-embedded components) is a lightbox */
function hasLightboxLayers(layers: Layer[]): boolean {
  return layerTreeHasLayer(layers, layer => layer.name === 'lightbox');
}

/**
 * Recursively check if any layer in the tree has interactions configured.
 * Used to skip rendering AnimationInitializer (and shipping ~50KB of GSAP +
 * ScrollTrigger + SplitText to the client) for pages with no animations.
 */
function hasAnyInteractions(layers: Layer[]): boolean {
  for (const layer of layers) {
    if (layer.interactions?.length) return true;
    if (layer.children && hasAnyInteractions(layer.children)) return true;
  }
  return false;
}

interface PageRendererProps {
  page: Page;
  layers: Layer[];
  components: Component[];
  generatedCss?: string;
  colorVariablesCss?: string;
  collectionItem?: CollectionItemWithValues;
  collectionFields?: CollectionField[];
  /**
   * Ordered list of collection item ids on the dynamic page's collection.
   * Used to resolve `next-item` / `previous-item` link keywords. Only relevant
   * for dynamic pages.
   */
  pageCollectionSortedItemIds?: string[];
  /**
   * Map of `collection_item_id -> slug` for every item in
   * `pageCollectionSortedItemIds`. Merged into the slug lookup so next/previous
   * links resolve to a real URL.
   */
  pageCollectionSortedItemSlugs?: Record<string, string>;
  locale?: Locale | null;
  availableLocales?: Locale[];
  isPreview?: boolean;
  previewProjectParam?: string | null;
  renderProjectId?: string | null;
  customCodeProjectId?: string | null;
  translations?: Record<string, any> | null;
  gaMeasurementId?: string | null;
  globalCustomCodeHead?: string | null;
  globalCustomCodeBody?: string | null;
  ycodeBadge?: boolean;
  passwordProtection?: PasswordProtectionContext;
}

/**
 * Shared component for rendering published/preview pages
 * Handles layer resolution, CSS injection, and custom code injection
 *
 * Note: This is a Server Component. Script/style tags are automatically
 * hoisted to <head> by Next.js during SSR, eliminating FOUC.
 */
/** Extract body layer from the tree and return its classes/style/attrs + children to render */
function extractBodyLayer(layers: Layer[]): { hasBodyLayer: boolean; bodyClasses: string; bodyStyle: string; bodyAttributes: Record<string, unknown>; childLayers: Layer[] } {
  const bodyLayer = layers.find(l => l.id === 'body');
  if (!bodyLayer) {
    return { hasBodyLayer: false, bodyClasses: '', bodyStyle: '', bodyAttributes: {}, childLayers: layers };
  }

  const otherLayers = layers.filter(l => l.id !== 'body');
  return {
    hasBodyLayer: true,
    bodyClasses: getClassesString(bodyLayer),
    bodyStyle: typeof bodyLayer.attributes?.style === 'string' ? bodyLayer.attributes.style : '',
    bodyAttributes: bodyLayer.attributes || {},
    childLayers: [...(bodyLayer.children || []), ...otherLayers],
  };
}

function bodyStyleForSsr(style: string): string {
  return parseSafeBodyStyle(style)
    .map(({ prop, value, priority }) => `${prop}:${value}${priority ? ' !important' : ''}`)
    .join(';');
}

function bodyStyleDeclarationsForBootstrap(style: string): Array<{ prop: string; value: string; priority: string }> {
  return parseSafeBodyStyle(style);
}

function safeBodyClassList(classes: string): string[] {
  const classList = (classes || 'bg-white')
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className.length > 0 && !/[<>"'=&]/.test(className));
  return classList.length > 0 ? classList : ['bg-white'];
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function safeGaMeasurementId(value?: string | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^(G|GT|UA|AW|DC)-[A-Z0-9-]+$/i.test(trimmed) ? trimmed : null;
}

function escapeStyleBoundary(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function fontStylesheetLoaderScript(url: string): string {
  return `(function(){var href=${scriptJson(url)};if(document.querySelector('link[data-ycode-font-href="'+href.replace(/"/g,'\\"')+'"]'))return;var l=document.createElement('link');l.rel='stylesheet';l.href=href;l.dataset.ycodeFontHref=href;document.head.appendChild(l);})()`;
}

function bodyBootstrapScript(classes: string, style: string): string {
  const classList = safeBodyClassList(classes);
  const styleDeclarations = bodyStyleDeclarationsForBootstrap(style);
  return `(function(){var next=${scriptJson(classList)};var decls=${scriptJson(styleDeclarations)};function apply(){var b=document.body;if(!b)return;var prev=(b.dataset.ycodeAppliedBodyClasses||'').split(/\\s+/).filter(Boolean);if(prev.length)b.classList.remove.apply(b.classList,prev);if(b.classList.contains('text-xs'))b.dataset.ycodeRemovedShellTextXs='true';b.classList.remove('text-xs');if(next.length)b.classList.add.apply(b.classList,next);b.dataset.ycodeAppliedBodyClasses=next.join(' ');var prevProps=(b.dataset.ycodeAppliedBodyStyleProps||'').split(',').filter(Boolean);prevProps.forEach(function(prop){b.style.removeProperty(prop)});var snap={};decls.forEach(function(d){var value=b.style.getPropertyValue(d.prop);var priority=b.style.getPropertyPriority(d.prop);snap[d.prop]={value:value,priority:priority,hadValue:value!==''||priority!==''};b.style.setProperty(d.prop,d.value,d.priority||'')});b.dataset.ycodeAppliedBodyStyleProps=decls.map(function(d){return d.prop}).join(',');b.dataset.ycodeBootstrapBodyStyleSnapshot=JSON.stringify(snap)}if(document.body)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});})()`;
}

function hasStudioPageTransition(layers: Layer[]): boolean {
  const scan = (layer: Layer): boolean => {
    if (layer.attributes?.['data-studio-page-transition'] !== undefined) return true;
    return Array.isArray(layer.children) && layer.children.some(scan);
  };

  return layers.some(scan);
}

function pageTransitionInitialCss(): string {
  return [
    '@keyframes ycode-studio-page-transition{from{transform:translateY(12px)}to{transform:translateY(0)}}',
    '@media (prefers-reduced-motion:no-preference) and (min-width:768px){[data-studio-page-transition]{opacity:1;will-change:transform;animation:ycode-studio-page-transition 360ms cubic-bezier(0.16,1,0.3,1) both}}',
    '@media (max-width:767px),(prefers-reduced-motion:reduce){[data-studio-page-transition]{opacity:1;transform:none;animation:none}}',
  ].join('');
}

function isProjectScopeRequired(): boolean {
  return process.env.STUDIO_REQUIRE_SHARED_DB_PROJECT_SCOPE === '1';
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  if (err.code === '42703') return true;
  const message = [err.message, err.details, err.hint].filter(Boolean).join(' ').toLowerCase();
  return (
    message.includes('column')
    && (
      message.includes('could not find')
      || message.includes('does not exist')
      || message.includes('schema cache')
    )
  );
}

const renderProjectScopeColumnCache = new Set<string>();

async function renderTableHasProjectScope(client: any, tableName: string): Promise<boolean> {
  if (renderProjectScopeColumnCache.has(tableName)) {
    return true;
  }
  const { error } = await client.from(tableName).select('project_id').limit(0);
  if (!error) {
    renderProjectScopeColumnCache.add(tableName);
    return true;
  }
  if (isProjectScopeRequired() && !isMissingColumnError(error)) {
    throw new Error(`Failed to inspect project scope for ${tableName}: ${error.message}`);
  }
  return false;
}

function applyRenderProjectScopeToBuilder(query: any, tableName: string, projectId: string | null, hasProjectScope: boolean) {
  if (!hasProjectScope) {
    if (isProjectScopeRequired()) {
      throw new Error(`Project scope column is required for ${tableName}`);
    }
    return query;
  }
  if (!projectId) {
    throw new Error(`Project scope is required to render ${tableName}`);
  }
  return query.eq('project_id', projectId);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

function getRenderProjectId(page: Page): string | null {
  const pageWithProject = page as Page & { project_id?: unknown };
  const settings = page.settings as (Page['settings'] & { studio_import?: Record<string, unknown> }) | undefined;
  const studioImport = settings?.studio_import;
  const candidates = [
    pageWithProject.project_id,
    studioImport?.applied_project_id,
  ];
  for (const candidate of candidates) {
    if (isUuid(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function getRenderPages(projectId: string | null, isPublished: boolean): Promise<Page[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client.from('pages').select('*').eq('is_published', isPublished).is('deleted_at', null);
  query = applyRenderProjectScopeToBuilder(query, 'pages', projectId, await renderTableHasProjectScope(client, 'pages'));
  const { data, error } = await query.order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch render pages: ${error.message}`);
  return data || [];
}

async function getRenderPageFolders(projectId: string | null, isPublished: boolean): Promise<PageFolder[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client.from('page_folders').select('*').eq('is_published', isPublished).is('deleted_at', null);
  query = applyRenderProjectScopeToBuilder(query, 'page_folders', projectId, await renderTableHasProjectScope(client, 'page_folders'));
  const { data, error } = await query.order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch render page folders: ${error.message}`);
  return data || [];
}

async function getRenderFonts(projectId: string | null, isPreview: boolean): Promise<Font[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client
    .from('fonts')
    .select('*')
    .eq('is_published', isPreview ? false : true)
    .is('deleted_at', null);
  query = applyRenderProjectScopeToBuilder(query, 'fonts', projectId, await renderTableHasProjectScope(client, 'fonts'));
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(SUPABASE_QUERY_LIMIT);
  if (error) throw new Error(`Failed to fetch render fonts: ${error.message}`);
  return data || [];
}

async function getRenderColorVariables(projectId: string | null): Promise<ColorVariable[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client.from('color_variables').select('*');
  query = applyRenderProjectScopeToBuilder(query, 'color_variables', projectId, await renderTableHasProjectScope(client, 'color_variables'));
  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch render color variables: ${error.message}`);
  return data || [];
}

async function getRenderFieldsByCollectionId(collectionId: string, isPublished: boolean, projectId: string | null): Promise<CollectionField[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client
    .from('collection_fields')
    .select('*')
    .eq('collection_id', collectionId)
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  query = applyRenderProjectScopeToBuilder(query, 'collection_fields', projectId, await renderTableHasProjectScope(client, 'collection_fields'));
  const { data, error } = await query.order('order', { ascending: true });
  if (error) throw new Error(`Failed to fetch render collection fields: ${error.message}`);
  return data || [];
}

async function getRenderItemWithValues(id: string, isPublished: boolean, projectId: string | null): Promise<CollectionItemWithValues | null> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let itemQuery = client
    .from('collection_items')
    .select('*')
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  itemQuery = applyRenderProjectScopeToBuilder(itemQuery, 'collection_items', projectId, await renderTableHasProjectScope(client, 'collection_items'));
  const { data: item, error: itemError } = await itemQuery.maybeSingle();
  if (itemError) throw new Error(`Failed to fetch render collection item: ${itemError.message}`);
  if (!item) return null;

  let valuesQuery = client
    .from('collection_item_values')
    .select('value, field_id, collection_fields!inner(type)')
    .eq('item_id', id)
    .eq('is_published', isPublished);
  valuesQuery = applyRenderProjectScopeToBuilder(valuesQuery, 'collection_item_values', projectId, await renderTableHasProjectScope(client, 'collection_item_values'));
  valuesQuery = valuesQuery.is('deleted_at', null);
  const { data: valuesData, error: valuesError } = await valuesQuery;
  if (valuesError) throw new Error(`Failed to fetch render collection item values: ${valuesError.message}`);

  const values: Record<string, any> = {};
  valuesData?.forEach((row: any) => {
    if (row.field_id) {
      const fieldType = row.collection_fields?.type;
      values[row.field_id] = castValue(row.value, fieldType || 'text');
    }
  });
  return { ...item, values };
}

async function getRenderItemsWithValues(collectionId: string, isPublished: boolean, projectId: string | null): Promise<{ items: CollectionItemWithValues[] }> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let itemsQuery = client
    .from('collection_items')
    .select('*')
    .eq('collection_id', collectionId)
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  itemsQuery = applyRenderProjectScopeToBuilder(itemsQuery, 'collection_items', projectId, await renderTableHasProjectScope(client, 'collection_items'));
  const { data: items, error: itemsError } = await itemsQuery
    .order('manual_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(SUPABASE_QUERY_LIMIT);
  if (itemsError) throw new Error(`Failed to fetch render collection items: ${itemsError.message}`);
  if (!items || items.length === 0) return { items: [] };

  let valuesQuery = client
    .from('collection_item_values')
    .select('item_id, value, field_id, collection_fields!inner(type)')
    .in('item_id', items.map((item: { id: string }) => item.id))
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  valuesQuery = applyRenderProjectScopeToBuilder(valuesQuery, 'collection_item_values', projectId, await renderTableHasProjectScope(client, 'collection_item_values'));
  const { data: valuesData, error: valuesError } = await valuesQuery;
  if (valuesError) throw new Error(`Failed to fetch render collection item values: ${valuesError.message}`);

  const valuesByItem: Record<string, Record<string, any>> = {};
  valuesData?.forEach((row: any) => {
    if (!row.item_id || !row.field_id) return;
    const fieldType = row.collection_fields?.type;
    valuesByItem[row.item_id] ||= {};
    valuesByItem[row.item_id][row.field_id] = castValue(row.value, fieldType || 'text');
  });
  return {
    items: items.map((item: any) => ({
      ...item,
      values: valuesByItem[item.id] || {},
    })),
  };
}

async function getRenderAssetsByIds(ids: string[], isPublished: boolean, projectId: string | null): Promise<Record<string, Asset>> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  if (ids.length === 0) return {};

  let query = client
    .from('assets')
    .select('*')
    .eq('is_published', isPublished)
    .in('id', ids);
  query = applyRenderProjectScopeToBuilder(query, 'assets', projectId, await renderTableHasProjectScope(client, 'assets'));
  if (!isPublished) query = query.is('deleted_at', null);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch render assets: ${error.message}`);

  const assetMap: Record<string, Asset> = {};
  data?.forEach((asset: Asset) => {
    assetMap[asset.id] = asset;
  });
  return assetMap;
}

export default async function PageRenderer({
  page,
  layers,
  components,
  generatedCss,
  colorVariablesCss,
  collectionItem,
  collectionFields = [],
  pageCollectionSortedItemIds,
  pageCollectionSortedItemSlugs,
  locale,
  availableLocales = [],
  isPreview = false,
  previewProjectParam = null,
  renderProjectId: explicitRenderProjectId = null,
  customCodeProjectId: explicitCustomCodeProjectId = null,
  translations,
  gaMeasurementId,
  globalCustomCodeHead,
  globalCustomCodeBody,
  ycodeBadge = false,
  passwordProtection,
}: PageRendererProps) {
  const usePublishedData = page.is_published && !isPreview;
  const sharedDbScopedRender = isProjectScopeRequired();
  const pageRenderProjectId = getRenderProjectId(page);
  const scopedRenderProjectId = isUuid(explicitRenderProjectId) ? explicitRenderProjectId : null;
  if (pageRenderProjectId && scopedRenderProjectId && pageRenderProjectId !== scopedRenderProjectId) {
    throw new Error('Project-scoped preview render project mismatch');
  }
  // In the isolated-site MVP the preview `project` param is still carried into
  // render repositories. Tables without project_id stay site-local; tables with
  // project_id are scoped by the repository helper.
  const renderProjectId = scopedRenderProjectId || pageRenderProjectId;
  if (isPreview && previewProjectParam && sharedDbScopedRender && !renderProjectId) {
    throw new Error('Project-scoped preview render requires a resolved project id');
  }
  const requireScopedRender = sharedDbScopedRender;
  const handleRenderFetchError = (label: string, error: unknown) => {
    console.error(`[PageRenderer] ${label}:`, error);
    if (requireScopedRender) {
      throw error;
    }
  };
  // Check if this is a 401 error page that needs password form
  const is401Page = page.error_page === 401;
  // Layers are always pre-resolved by the caller (page-fetcher).
  // Components are passed through for rich-text embedded component rendering in LayerRenderer.
  const resolvedLayers = layers || [];
  // When the 401 page contains an editable password-protected form layer, the form
  // is rendered & wired inline by LayerRendererPublic; otherwise we fall back to
  // the hardcoded PasswordForm so older / customised 401 pages still work.
  const hasInlinePasswordForm = is401Page && hasPasswordFormLayer(resolvedLayers);

  // Single tree traversal — derive both sets from the flat list
  const allPageLinks = collectLayerPageLinks(resolvedLayers);
  const referencedItemIds = new Set(
    allPageLinks
      .filter(l => !isCollectionItemKeyword(l.collection_item_id) && !l.collection_item_id.startsWith('ref-'))
      .map(l => l.collection_item_id)
  );

  // Build collection item slugs map
  const collectionItemSlugs: Record<string, string> = {};

  // Add slugs from resolved collection layers (for 'current-collection' links)
  const resolvedSlugs = extractCollectionItemSlugs(resolvedLayers);
  Object.assign(collectionItemSlugs, resolvedSlugs);

  // Add current page's collection item if available
  if (collectionItem && collectionFields) {
    const slugField = collectionFields.find(f => f.key === 'slug');
    if (slugField && collectionItem.values[slugField.id]) {
      collectionItemSlugs[collectionItem.id] = collectionItem.values[slugField.id];
    }
  }

  // Merge slugs for the dynamic page's collection (next/previous navigation).
  if (pageCollectionSortedItemSlugs) {
    Object.assign(collectionItemSlugs, pageCollectionSortedItemSlugs);
  }

  let pages: Page[] = [];
  let folders: PageFolder[] = [];
  const renderIsPublished = !isPreview;

  try {
    if (renderProjectId || isProjectScopeRequired()) {
      // Studio: project-scoped render path goes through scoped Supabase helpers.
      [pages, folders] = await Promise.all([
        getRenderPages(renderProjectId, renderIsPublished),
        getRenderPageFolders(renderProjectId, renderIsPublished),
      ]);

      // Fetch collection items if we have references to them
      if (referencedItemIds.size > 0) {
        const itemsWithValues = await Promise.all(
          Array.from(referencedItemIds).map(itemId => getRenderItemWithValues(itemId, renderIsPublished, renderProjectId))
        );

        // For each item, find its collection's slug field and extract the slug
        for (const item of itemsWithValues) {
          if (!item) continue;

          const fields = await getRenderFieldsByCollectionId(item.collection_id, renderIsPublished, renderProjectId);
          const slugField = fields.find(f => f.key === 'slug');

          if (slugField && item.values[slugField.id]) {
            collectionItemSlugs[item.id] = item.values[slugField.id];
          }
        }
      }
    } else {
      // Start pages/folders fetch and referenced-item fetch in parallel
      const itemsMapPromise = referencedItemIds.size > 0
        ? getItemsWithValuesByIds(Array.from(referencedItemIds), usePublishedData)
        : Promise.resolve({} as Record<string, import('@/types').CollectionItemWithValues>);

      [[pages, folders]] = await Promise.all([
        usePublishedData
          ? Promise.all([getCachedPublishedPages(), getCachedPublishedFolders()])
          : Promise.all([
            getAllPages({ is_published: false }),
            getAllPageFolders({ is_published: false }),
          ]),
        itemsMapPromise.then(async (itemsMap) => {
          const collectionIds = new Set(Object.values(itemsMap).map(i => i.collection_id));
          const fieldsByCollection = new Map<string, CollectionField[]>();
          await Promise.all(
            Array.from(collectionIds).map(async (collId) => {
              const fields = await getFieldsByCollectionId(collId, usePublishedData);
              fieldsByCollection.set(collId, fields);
            })
          );

          for (const item of Object.values(itemsMap)) {
            const fields = fieldsByCollection.get(item.collection_id);
            const slugField = fields?.find(f => f.key === 'slug');
            if (slugField && item.values[slugField.id]) {
              collectionItemSlugs[item.id] = item.values[slugField.id];
            }
          }
        }),
      ]);
    }

    // ref-* links depend on `pages` being resolved, so this runs after
    const refTargetCollectionIds = new Set(
      allPageLinks
        .filter(l => l.collection_item_id.startsWith(REF_PAGE_PREFIX) || l.collection_item_id.startsWith(REF_COLLECTION_PREFIX))
        .map(l => pages.find(p => p.id === l.page_id)?.settings?.cms?.collection_id)
        .filter((id): id is string => !!id)
    );
    if (refTargetCollectionIds.size > 0) {
      const scopedRender = Boolean(renderProjectId) || isProjectScopeRequired();
      await Promise.all(
        Array.from(refTargetCollectionIds).map(async (collId) => {
          const [fields, { items }] = await Promise.all([
            scopedRender
              ? getRenderFieldsByCollectionId(collId, renderIsPublished, renderProjectId)
              : getFieldsByCollectionId(collId, usePublishedData),
            scopedRender
              ? getRenderItemsWithValues(collId, renderIsPublished, renderProjectId)
              : getItemsWithValues(collId, usePublishedData),
          ]);
          const slugField = fields.find(f => f.key === 'slug');
          if (!slugField) return;
          for (const item of items) {
            if (item.values[slugField.id]) {
              collectionItemSlugs[item.id] = item.values[slugField.id];
            }
          }
        })
      );
    }
  } catch (error) {
    handleRenderFetchError('Error fetching link resolution data', error);
  }

  const dedupedGlobalCustomCodeHead = removeDuplicateGoogleFontLinksFromHeadHtml(globalCustomCodeHead || '');

  // Referenced/ref item slugs above are stored in the source language. On a
  // non-default locale, swap each to its translated slug so dynamic-page links
  // resolve to the localized URL (e.g. /fr/.../a-fr instead of /fr/.../a-en).
  if (translations && locale && !locale.is_default) {
    for (const itemId of Object.keys(collectionItemSlugs)) {
      const translatedSlug = translations[`cms:${itemId}:field:key:slug`]?.content_value;
      if (translatedSlug) {
        collectionItemSlugs[itemId] = translatedSlug;
      }
    }
  }

  // Pre-compute localized URLs for the locale selector so switching language
  // preserves translated folder/page/CMS slugs instead of reusing the source slug.
  // Only runs on multi-locale pages that actually render a locale selector.
  let localizedPageUrls: Record<string, string> | undefined;
  if (
    availableLocales.length > 1 &&
    layerTreeHasLayer(resolvedLayers, l => l.name === 'localeSelector')
  ) {
    try {
      const translationsByLocale: Record<string, Record<string, Translation>> = {};
      await Promise.all(
        availableLocales
          .filter(l => !l.is_default)
          .map(async (l) => {
            // Reuse already-loaded translations for the current locale
            if (locale && l.id === locale.id && translations) {
              translationsByLocale[l.id] = translations as Record<string, Translation>;
              return;
            }
            const rows = await getTranslationsByLocale(l.id, usePublishedData);
            const map: Record<string, Translation> = {};
            for (const t of rows) {
              map[getTranslatableKey(t)] = t;
            }
            translationsByLocale[l.id] = map;
          })
      );

      // Dynamic pages need the translated CMS item slug per locale
      let dynamicSlug: LocalizedDynamicSlug | null = null;
      if (page.is_dynamic && collectionItem) {
        const slugField = collectionFields.find(f => f.key === 'slug');
        if (slugField) {
          // collectionItem.values are already translated for the current locale,
          // so fetch the raw (default-locale) slug to use as the default + fallback.
          const rawValues = await getValuesByItemIds([collectionItem.id], usePublishedData, undefined, [slugField.id]);
          const sourceSlug = rawValues[collectionItem.id]?.[slugField.id];
          if (sourceSlug) {
            dynamicSlug = {
              itemId: collectionItem.id,
              contentKey: slugField.key ? `field:key:${slugField.key}` : `field:id:${slugField.id}`,
              defaultValue: String(sourceSlug),
            };
          }
        }
      }

      localizedPageUrls = buildLocalizedPageUrls(page, folders, availableLocales, translationsByLocale, dynamicSlug);
    } catch (error) {
      console.error('[PageRenderer] Error building localized page URLs:', error);
    }
  }

  // Extract custom code from page settings and resolve placeholders for dynamic pages
  const rawPageCustomCodeHead = page.settings?.custom_code?.head || '';
  const rawPageCustomCodeBody = page.settings?.custom_code?.body || '';

  const pageCustomCodeHead = page.is_dynamic && collectionItem
    ? resolveCustomCodePlaceholders(rawPageCustomCodeHead, collectionItem, collectionFields)
    : rawPageCustomCodeHead;
  const dedupedPageCustomCodeHead = removeDuplicateGoogleFontLinksFromHeadHtml(pageCustomCodeHead, dedupedGlobalCustomCodeHead);

  const pageCustomCodeBody = page.is_dynamic && collectionItem
    ? resolveCustomCodePlaceholders(rawPageCustomCodeBody, collectionItem, collectionFields)
    : rawPageCustomCodeBody;
  const pageProjectId = typeof (page as Page & { project_id?: unknown }).project_id === 'string'
    ? (page as Page & { project_id?: string }).project_id || null
    : null;
  const customCodeRenderProjectId = explicitCustomCodeProjectId || renderProjectId || pageProjectId;
  const allowCustomCodeExecution = await canRenderStudioCustomCode(customCodeRenderProjectId, !isPreview, {
    requireProject: isProjectScopeRequired() || Boolean(process.env.STUDIO_YCODE_SITE_KEY && process.env.STUDIO_YCODE_SITE_KEY !== 'default'),
  });

  const { bodyClasses, bodyStyle, bodyAttributes, childLayers: rawChildLayers } = extractBodyLayer(resolvedLayers);
  const appliedBodyClasses = bodyClasses || 'bg-white';
  const appliedBodyStyle = bodyStyle || '';
  const runtimeProfile = typeof bodyAttributes['data-studio-runtime-profile'] === 'string'
    ? bodyAttributes['data-studio-runtime-profile']
    : undefined;
  const runtimeAdapters = typeof bodyAttributes['data-studio-runtime-adapters'] === 'string'
    ? bodyAttributes['data-studio-runtime-adapters']
    : undefined;
  const ssrBodyStyle = bodyStyleForSsr(appliedBodyStyle);
  const safeGaId = safeGaMeasurementId(gaMeasurementId);
  const hasLayers = rawChildLayers.length > 0;
  const hasPageTransition = hasStudioPageTransition(rawChildLayers);

  // Generate CSS for initial animation states to prevent flickering
  const { css: initialAnimationCSS, hiddenLayerInfo } = generateInitialAnimationCSS(resolvedLayers);

  // Strip heavy SSR-only data before crossing the client component boundary.
  // On published pages, all variables are pre-resolved so _collectionItemValues
  // and _layerDataMap are redundant — removing them can cut the payload by 10x+.
  const childLayers = usePublishedData ? stripSSROnlyData(rawChildLayers) : rawChildLayers;
  const animationLayers = usePublishedData ? extractAnimationLayers(resolvedLayers) : resolvedLayers;

  // Load installed fonts and generate CSS + link URLs
  let fontsCss = '';
  let googleFontsInlinedCss = '';
  let googleFontLinkUrls: string[] = [];
  try {
    const { getAllFonts: getAllDraftFonts } = await import('@/lib/repositories/fontRepository');
    const { getPublishedFonts } = await import('@/lib/repositories/fontRepository');
    const fonts = (renderProjectId || isProjectScopeRequired())
      ? await getRenderFonts(renderProjectId, isPreview)
      : (isPreview ? await getAllDraftFonts() : await getPublishedFonts());
    fontsCss = buildCustomFontsCss(fonts) + buildFontClassesCss(fonts);
    googleFontLinkUrls = filterGoogleFontLinksAgainstHeadHtml(
      getGoogleFontLinks(fonts),
      dedupedGlobalCustomCodeHead,
      dedupedPageCustomCodeHead,
    );

    // Inline the resolved @font-face CSS so the browser skips the blocking
    // round-trip to fonts.googleapis.com and goes straight to gstatic for
    // the woff2 binaries. Cached per font config across requests.
    googleFontsInlinedCss = await getInlinedGoogleFontsCss(googleFontLinkUrls);
  } catch (error) {
    handleRenderFetchError('Error loading fonts', error);
  }

  // Fetch server-side settings needed by LayerRenderer (map tokens, color variables, timezone).
  // A build without Supabase credentials should still complete; individual
  // repository helpers already fail closed, so keep this fetch best-effort.
  let mapboxToken: string | null = null;
  let googleMapsEmbedKey: string | null = null;
  let serverColorVariables: Awaited<ReturnType<typeof getAllColorVariables>> = [];
  let timezoneSetting: Awaited<ReturnType<typeof getSettingByKey>> | null = null;
  try {
    [mapboxToken, googleMapsEmbedKey, serverColorVariables, timezoneSetting] = await Promise.all([
      getMapboxAccessToken(),
      getGoogleMapsEmbedApiKey(),
      (renderProjectId || isProjectScopeRequired()) ? getRenderColorVariables(renderProjectId) : getAllColorVariables(),
      getSettingByKey('timezone').catch(() => null),
    ]);
  } catch (error) {
    handleRenderFetchError('Error fetching server settings', error);
  }
  const serverSettings: Record<string, unknown> = {};
  if (mapboxToken) {
    serverSettings.mapbox_access_token = mapboxToken;
  }
  if (googleMapsEmbedKey) {
    serverSettings.google_maps_embed_api_key = googleMapsEmbedKey;
  }
  if (serverColorVariables.length > 0) {
    serverSettings.color_variables = serverColorVariables;
  }
  if (typeof timezoneSetting === 'string' && timezoneSetting) {
    serverSettings.timezone = timezoneSetting;
  }

  // Pre-resolve all asset URLs for SSR (images, videos, audio, icons, and field values)
  const layerAssetIds = collectLayerAssetIds(resolvedLayers, components);

  // Also collect from page collection item values (for dynamic pages)
  if (collectionItem) {
    for (const value of Object.values(collectionItem.values)) {
      if (typeof value === 'string') {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          layerAssetIds.add(value);
        } else if (value.startsWith('{')) {
          const linkValue = parseCollectionLinkValue(value);
          if (linkValue?.type === 'asset' && linkValue.asset?.id) {
            layerAssetIds.add(linkValue.asset.id);
          }
        }
      }
    }
  }

  // Fetch all assets and build resolved map
  // Use draft assets (isPublished=false) for preview mode, published assets otherwise
  // `mimeType` is tracked locally so the LCP heuristic can skip SVG logos;
  // it is stripped before passing the map across the client boundary.
  type ResolvedAssetEntry = { url: string; width?: number | null; height?: number | null; mimeType?: string };
  let resolvedAssetsWithMime: Record<string, ResolvedAssetEntry> | undefined;
  if (layerAssetIds.size > 0) {
    try {
      const { getAssetsByIds } = await import('@/lib/repositories/assetRepository');
      const assetIds = Array.from(layerAssetIds);
      const assetMap = (renderProjectId || isProjectScopeRequired())
        ? await getRenderAssetsByIds(assetIds, !isPreview, renderProjectId)
        : await getAssetsByIds(assetIds, !isPreview);
      resolvedAssetsWithMime = {};
      for (const [id, asset] of Object.entries(assetMap)) {
        let url: string | undefined;
        const proxyUrl = getAssetProxyUrl(asset);
        if (proxyUrl) {
          url = proxyUrl;
        } else if (asset.public_url) {
          url = asset.public_url;
        } else if (asset.content) {
          url = asset.content;
        }
        if (url) {
          resolvedAssetsWithMime[id] = { url, width: asset.width, height: asset.height, mimeType: asset.mime_type };
        }
      }
    } catch (error) {
      handleRenderFetchError('Error fetching assets', error);
    }
  }

  // Identify the LCP candidate so the renderer can flip its loading=lazy
  // template default to eager + fetchpriority=high. Skips logos/icons by
  // ignoring images inside header/footer/nav and SVG-backed assets.
  const lcpCandidate = findLcpCandidate(childLayers, resolvedAssetsWithMime);
  const lcpCandidateLayerId = lcpCandidate?.layerId ?? null;

  // Resolve the candidate's URL so we can emit <link rel="preload" as="image">
  // in <head>. The browser starts fetching the hero image as soon as it parses
  // the preload — well before it reaches the <img> tag deeper in the document.
  // Only handles asset-variable images; CMS field-bound images on dynamic
  // pages would need item-aware resolution.
  let lcpPreloadSrc: string | null = null;
  let lcpPreloadSrcset: string | null = null;
  let lcpPreloadSizes: string | null = null;
  if (lcpCandidate?.assetId && resolvedAssetsWithMime) {
    const candidateAsset = resolvedAssetsWithMime[lcpCandidate.assetId];
    if (candidateAsset?.url) {
      lcpPreloadSrc = getOptimizedImageUrl(candidateAsset.url, 1920, 85);
      lcpPreloadSrcset = generateImageSrcset(candidateAsset.url, undefined, undefined, candidateAsset.width) || null;
      lcpPreloadSizes = buildImageSizes(candidateAsset.width || null);
    }
  }

  // Strip mimeType before crossing the client component boundary — only
  // url/width/height are part of the shared `resolvedAssets` contract.
  const resolvedAssets: Record<string, { url: string; width?: number | null; height?: number | null }> | undefined =
    resolvedAssetsWithMime
      ? Object.fromEntries(
        Object.entries(resolvedAssetsWithMime).map(([id, { url, width, height }]) => [id, { url, width, height }])
      )
      : undefined;

  return (
    <>
      {/* Global head code fallback when layout skips it (SKIP_SETUP mode) */}
      {allowCustomCodeExecution && process.env.SKIP_SETUP === 'true' && dedupedGlobalCustomCodeHead && (
        renderRootLayoutHeadCode(dedupedGlobalCustomCodeHead, 'global-head')
      )}

      {/* Page-specific custom head code — React 19 hoists meta/link/style/title to <head> */}
      {allowCustomCodeExecution && dedupedPageCustomCodeHead && renderRootLayoutHeadCode(dedupedPageCustomCodeHead, 'page-head')}

      {/* Preload the LCP image so the browser starts the fetch from <head>
          rather than waiting until the parser reaches the <img> tag. Pairs
          with the eager + fetchpriority=high props the renderer sets on the
          same layer below. */}
      {lcpPreloadSrc && (
        lcpPreloadSrcset ? (
          <link
            rel="preload"
            as="image"
            href={lcpPreloadSrc}
            imageSrcSet={lcpPreloadSrcset}
            imageSizes={lcpPreloadSizes || undefined}
            fetchPriority="high"
          />
        ) : (
          <link
            rel="preload"
            as="image"
            href={lcpPreloadSrc}
            fetchPriority="high"
          />
        )
      )}

      {/* Strip native browser appearance from form elements so Tailwind classes apply */}
      <style
        id="ycode-form-reset"
        dangerouslySetInnerHTML={{ __html: FORM_RESET_CSS }}
      />

      {/* Inject CSS directly — React 19 hoists <style> with precedence to <head> */}
      {generatedCss && (
        <style
          id="ycode-styles"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(generatedCss) }}
        />
      )}

      {/* Inject color variable CSS custom properties */}
      {colorVariablesCss && (
        <style
          id="ycode-color-vars"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(colorVariablesCss) }}
        />
      )}

      {/* Warm up the Google Fonts origins. When CSS is inlined below we only
          need gstatic (the binary origin); when we fall back to the
          non-blocking stylesheet loader we also need googleapis. `crossOrigin`
          on gstatic is required because font files are fetched in CORS mode. */}
      {googleFontLinkUrls.length > 0 && (
        <>
          {!googleFontsInlinedCss && (
            <link rel="preconnect" href="https://fonts.googleapis.com" />
          )}
          <link
            rel="preconnect" href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
        </>
      )}

      {/* Inline resolved @font-face rules when available — skips the blocking
          CSS request to fonts.googleapis.com. Falls back to loading the
          stylesheets without render-blocking if the publish-time fetch failed. */}
      {googleFontsInlinedCss ? (
        <style
          id="ycode-google-fonts"
          dangerouslySetInnerHTML={{ __html: googleFontsInlinedCss }}
        />
      ) : (
        googleFontLinkUrls.map((url, i) => (
          <Fragment key={`gfont-${i}`}>
            <script
              dangerouslySetInnerHTML={{ __html: fontStylesheetLoaderScript(url) }}
            />
            <noscript
              dangerouslySetInnerHTML={{
                __html: `<link rel="stylesheet" href="${url.replace(/"/g, '&quot;')}">`,
              }}
            />
          </Fragment>
        ))
      )}

      {/* Inject custom font @font-face rules and font class CSS */}
      {fontsCss && (
        <style
          id="ycode-fonts"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(fontsCss) }}
        />
      )}

      {ssrBodyStyle && (
        <style
          id="ycode-body-layer-style"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(`body{${ssrBodyStyle}}`) }}
        />
      )}

      <script
        id="ycode-body-layer-class-bootstrap"
        dangerouslySetInnerHTML={{ __html: bodyBootstrapScript(appliedBodyClasses, appliedBodyStyle) }}
      />

      {hasPageTransition && (
        <style
          id="ycode-studio-page-transition-initial"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(pageTransitionInitialCss()) }}
        />
      )}

      {/* Inject initial animation styles to prevent flickering */}
      {initialAnimationCSS && (
        <style
          id="ycode-gsap-initial-styles"
          dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(initialAnimationCSS) }}
        />
      )}

      {/* Inject Google Analytics script (non-preview only) */}
      {allowCustomCodeExecution && safeGaId && (
        <>
          <script
            async
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(safeGaId)}`}
          />
          <script
            id="google-analytics"
            dangerouslySetInnerHTML={{
              __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', ${scriptJson(safeGaId)});
              `,
            }}
          />
        </>
      )}

      <BodyClassApplier classes={appliedBodyClasses} style={appliedBodyStyle} />

      <main
        id="ybody"
        className="contents"
        data-layer-id="body"
        data-layer-type="div"
        data-is-empty={hasLayers ? 'false' : 'true'}
        data-studio-runtime-profile={runtimeProfile}
        data-studio-runtime-adapters={runtimeAdapters}
      >
        <LayerRendererPublic
          layers={childLayers}
          isPublished={page.is_published}
          pageId={page.id}
          pageCollectionItemId={collectionItem?.id}
          pageCollectionItemData={collectionItem?.values || undefined}
          pageCollectionSortedItemIds={pageCollectionSortedItemIds}
          hiddenLayerInfo={hiddenLayerInfo}
          currentLocale={locale}
          availableLocales={availableLocales}
          localizedPageUrls={localizedPageUrls}
          pages={pages as any}
          folders={folders as any}
          collectionItemSlugs={collectionItemSlugs}
          isPreview={isPreview}
          previewProjectParam={previewProjectParam}
          translations={translations}
          resolvedAssets={resolvedAssets}
          components={components}
          allowCustomCodeExecution={allowCustomCodeExecution}
          serverSettings={serverSettings}
          lcpCandidateLayerId={lcpCandidateLayerId}
          passwordProtection={is401Page ? passwordProtection : undefined}
        />

        {/* Fallback hardcoded password form: only when the 401 page has no inline
            password-protected form layer (e.g. older / customised 401 pages). */}
        {is401Page && passwordProtection && !hasInlinePasswordForm && (
          <PasswordForm
            pageId={passwordProtection.pageId}
            folderId={passwordProtection.folderId}
            redirectUrl={passwordProtection.redirectUrl}
            isPublished={passwordProtection.isPublished}
          />
        )}
      </main>

      {/* Initialize GSAP animations based on layer interactions.
          Always rendered: the Studio global runtime (page transitions, embedded
          script execution, reveal handling) must initialize even when no layer
          has interactions. Layers are pre-stripped on published pages (and
          emptied when no layer has interactions) to minimize the payload. */}
      <AnimationInitializer
        layers={hasAnyInteractions(resolvedLayers) ? animationLayers : []}
        initializeGlobalRuntime
      />

      {/* Initialize Swiper on slider elements */}
      {hasSliderLayers(resolvedLayers) && <SliderInitializer />}

      {/* Initialize lightbox modals */}
      {hasLightboxLayers(resolvedLayers) && <LightboxInitializer />}

      {/* Report content height to parent for zoom calculations (preview only) */}
      {!page.is_published && <ContentHeightReporter />}

      {/* Inject global custom body code (applies to all pages) */}
      {allowCustomCodeExecution && globalCustomCodeBody && (
        <CustomCodeInjector html={globalCustomCodeBody} />
      )}

      {/* Inject page-specific custom body code */}
      {allowCustomCodeExecution && pageCustomCodeBody && (
        <CustomCodeInjector html={pageCustomCodeBody} />
      )}

      {/* Studio badge (only on published pages, not in preview) */}
      {ycodeBadge && !isPreview && (
        <a
          href="https://studio.novum-partners.de"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Diese Website wird mit Studio verwaltet."
          style={{
            height: 'auto',
            background: '#050606',
            padding: '12px 14px',
            width: 'auto',
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            zIndex: 9999,
            opacity: 1,
          }}
        >
          <svg
            width="12px"
            height="12px"
            viewBox="0 0 12 12"
            xmlns="http://www.w3.org/2000/svg"
            style={{ marginRight: '6px' }}
          >
            <path
              d="M5.23207667,-2.48689958e-14 L5.23207667,2.92938975 L2.533,4.49 L5.82778675,6.39340042 L11.04327,3.37550675 L11.04327,6.30763586 L1.21758048,11.9928333 L1.2051863,12 L1.19159064,11.9913578 L4.61852778e-14,11.2356683 L4.61852778e-14,8.38082539 L1.20208775,9.06966211 L3.257,7.88 L4.61852778e-14,5.95450495 L4.61852778e-14,3.02687758 L5.23207667,-2.48689958e-14 Z"
              fill="#FFFFFF"
              fillRule="nonzero"
            />
          </svg>
          <svg
            width="80px"
            height="12px"
            viewBox="0 0 80 12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M-5.68434189e-14,1.421875 L1.93465909,1.421875 L4.52556818,7.74573864 L4.62784091,7.74573864 L7.21875,1.421875 L9.15340909,1.421875 L9.15340909,10.1491477 L7.63636364,10.1491477 L7.63636364,4.15340909 L7.55539773,4.15340909 L5.14346591,10.1235795 L4.00994318,10.1235795 L1.59801136,4.140625 L1.51704545,4.140625 L1.51704545,10.1491477 L-5.68434189e-14,10.1491477 L-5.68434189e-14,1.421875 Z M12.3903409,10.28125 C11.9755682,10.28125 11.6026989,10.2066761 11.271733,10.0575284 C10.940767,9.90838068 10.6794034,9.6875 10.487642,9.39488636 C10.2958807,9.10227273 10.2,8.74147727 10.2,8.3125 C10.2,7.94318182 10.2681818,7.63778409 10.4045455,7.39630682 C10.5409091,7.15482955 10.7269886,6.96164773 10.9627841,6.81676136 C11.1985795,6.671875 11.4649148,6.56178977 11.7617898,6.48650568 C12.0586648,6.41122159 12.3661932,6.35653409 12.684375,6.32244318 C13.0678977,6.28267045 13.3789773,6.24644886 13.6176136,6.21377841 C13.85625,6.18110795 14.0302557,6.12997159 14.1396307,6.06036932 C14.2490057,5.99076705 14.3036932,5.88210227 14.3036932,5.734375 L14.3036932,5.70880682 C14.3036932,5.38778409 14.2085227,5.13920455 14.0181818,4.96306818 C13.8278409,4.78693182 13.5536932,4.69886364 13.1957386,4.69886364 C12.8178977,4.69886364 12.518892,4.78125 12.2987216,4.94602273 C12.0785511,5.11079545 11.9301136,5.30539773 11.8534091,5.52982955 L10.4130682,5.32528409 C10.5267045,4.92755682 10.7142045,4.59446023 10.9755682,4.32599432 C11.2369318,4.05752841 11.5565341,3.85582386 11.934375,3.72088068 C12.3122159,3.5859375 12.7298295,3.51846591 13.1872159,3.51846591 C13.5025568,3.51846591 13.8164773,3.55539773 14.1289773,3.62926136 C14.4414773,3.703125 14.7269886,3.82457386 14.9855114,3.99360795 C15.2440341,4.16264205 15.4521307,4.39204545 15.6098011,4.68181818 C15.7674716,4.97159091 15.8463068,5.33380682 15.8463068,5.76846591 L15.8463068,10.1491477 L14.3633523,10.1491477 L14.3633523,9.25 L14.3122159,9.25 C14.2184659,9.43181818 14.0870739,9.6015625 13.9180398,9.75923295 C13.7490057,9.91690341 13.537358,10.0433239 13.2830966,10.1384943 C13.0288352,10.2336648 12.73125,10.28125 12.3903409,10.28125 Z M12.7909091,9.14772727 C13.1005682,9.14772727 13.3690341,9.0859375 13.5963068,8.96235795 C13.8235795,8.83877841 13.9990057,8.67471591 14.1225852,8.47017045 C14.2461648,8.265625 14.3079545,8.04261364 14.3079545,7.80113636 L14.3079545,7.02982955 C14.2596591,7.06960227 14.177983,7.10653409 14.0629261,7.140625 C13.9478693,7.17471591 13.8193182,7.20454545 13.6772727,7.23011364 C13.5352273,7.25568182 13.3946023,7.27840909 13.2553977,7.29829545 C13.1161932,7.31818182 12.9954545,7.33522727 12.8931818,7.34943182 C12.6630682,7.38068182 12.4571023,7.43181818 12.2752841,7.50284091 C12.0934659,7.57386364 11.95,7.67258523 11.8448864,7.79900568 C11.7397727,7.92542614 11.6872159,8.08806818 11.6872159,8.28693182 C11.6872159,8.57102273 11.7909091,8.78551136 11.9982955,8.93039773 C12.2056818,9.07528409 12.4698864,9.14772727 12.7909091,9.14772727 Z M19.5306818,10.2642045 C19.0164773,10.2642045 18.55625,10.1321023 18.15,9.86789773 C17.74375,9.60369318 17.4227273,9.22017045 17.1869318,8.71732955 C16.9511364,8.21448864 16.8332386,7.60369318 16.8332386,6.88494318 C16.8332386,6.15767045 16.953267,5.54332386 17.1933239,5.04190341 C17.4333807,4.54048295 17.7579545,4.16122159 18.1670455,3.90411932 C18.5761364,3.64701705 19.0321023,3.51846591 19.5349432,3.51846591 C19.9184659,3.51846591 20.2338068,3.58309659 20.4809659,3.71235795 C20.728125,3.84161932 20.9241477,3.99644886 21.0690341,4.17684659 C21.2139205,4.35724432 21.3261364,4.52698864 21.4056818,4.68607955 L21.4696023,4.68607955 L21.4696023,1.421875 L23.0164773,1.421875 L23.0164773,10.1491477 L21.4994318,10.1491477 L21.4994318,9.11789773 L21.4056818,9.11789773 C21.3261364,9.27698864 21.2110795,9.4453125 21.0605114,9.62286932 C20.9099432,9.80042614 20.7110795,9.95170455 20.4639205,10.0767045 C20.2167614,10.2017045 19.9056818,10.2642045 19.5306818,10.2642045 Z M19.9610795,8.99857955 C20.2877841,8.99857955 20.5661932,8.90980114 20.7963068,8.73224432 C21.0264205,8.5546875 21.2011364,8.30681818 21.3204545,7.98863636 C21.4397727,7.67045455 21.4994318,7.29971591 21.4994318,6.87642045 C21.4994318,6.453125 21.440483,6.08522727 21.3225852,5.77272727 C21.2046875,5.46022727 21.031392,5.21732955 20.8026989,5.04403409 C20.5740057,4.87073864 20.2934659,4.78409091 19.9610795,4.78409091 C19.6173295,4.78409091 19.3303977,4.87357955 19.1002841,5.05255682 C18.8701705,5.23153409 18.696875,5.47869318 18.5803977,5.79403409 C18.4639205,6.109375 18.4056818,6.47017045 18.4056818,6.87642045 C18.4056818,7.28551136 18.4646307,7.64985795 18.5825284,7.96946023 C18.7004261,8.2890625 18.875142,8.54048295 19.1066761,8.72372159 C19.3382102,8.90696023 19.6230114,8.99857955 19.9610795,8.99857955 Z M27.2633523,10.2769886 C26.6071023,10.2769886 26.0410511,10.1399148 25.5651989,9.86576705 C25.0893466,9.59161932 24.7235795,9.20241477 24.4678977,8.69815341 C24.2122159,8.19389205 24.084375,7.59943182 24.084375,6.91477273 C24.084375,6.24147727 24.2129261,5.64985795 24.4700284,5.13991477 C24.7271307,4.62997159 25.0872159,4.23224432 25.5502841,3.94673295 C26.0133523,3.66122159 26.5573864,3.51846591 27.1823864,3.51846591 C27.5857955,3.51846591 27.9671875,3.58309659 28.3265625,3.71235795 C28.6859375,3.84161932 29.0041193,4.04119318 29.281108,4.31107955 C29.5580966,4.58096591 29.7761364,4.92400568 29.9352273,5.34019886 C30.0943182,5.75639205 30.1738636,6.25142045 30.1738636,6.82528409 L30.1738636,7.29829545 L24.8088068,7.29829545 L24.8088068,6.25852273 L28.6951705,6.25852273 C28.6923295,5.96306818 28.6284091,5.69957386 28.5034091,5.46803977 C28.3784091,5.23650568 28.2044034,5.05397727 27.981392,4.92045455 C27.7583807,4.78693182 27.4991477,4.72017045 27.2036932,4.72017045 C26.8883523,4.72017045 26.6113636,4.79616477 26.3727273,4.94815341 C26.1340909,5.10014205 25.9487216,5.29900568 25.8166193,5.54474432 C25.684517,5.79048295 25.6170455,6.05965909 25.6142045,6.35227273 L25.6142045,7.25994318 C25.6142045,7.640625 25.6838068,7.96661932 25.8230114,8.23792614 C25.9622159,8.50923295 26.1568182,8.71661932 26.4068182,8.86008523 C26.6568182,9.00355114 26.9494318,9.07528409 27.2846591,9.07528409 C27.5090909,9.07528409 27.7122159,9.04332386 27.8940341,8.97940341 C28.0758523,8.91548295 28.2335227,8.82102273 28.3670455,8.69602273 C28.5005682,8.57102273 28.6014205,8.41619318 28.6696023,8.23153409 L30.1099432,8.39346591 C30.0190341,8.77414773 29.8464489,9.10582386 29.5921875,9.38849432 C29.3379261,9.67116477 29.0133523,9.88991477 28.6184659,10.0447443 C28.2235795,10.1995739 27.771875,10.2769886 27.2633523,10.2769886 Z M33.8565341,10.1491477 L33.8565341,3.60369318 L35.3991477,3.60369318 L35.3991477,10.1491477 L33.8565341,10.1491477 Z M34.6321023,2.67471591 C34.3877841,2.67471591 34.1775568,2.59303977 34.0014205,2.4296875 C33.8252841,2.26633523 33.7372159,2.06960227 33.7372159,1.83948864 C33.7372159,1.60653409 33.8252841,1.40838068 34.0014205,1.24502841 C34.1775568,1.08167614 34.3877841,1 34.6321023,1 C34.8792614,1 35.0901989,1.08167614 35.2649148,1.24502841 C35.4396307,1.40838068 35.5269886,1.60653409 35.5269886,1.83948864 C35.5269886,2.06960227 35.4396307,2.26633523 35.2649148,2.4296875 C35.0901989,2.59303977 34.8792614,2.67471591 34.6321023,2.67471591 Z M38.2269886,6.31392045 L38.2269886,10.1491477 L36.684375,10.1491477 L36.684375,3.60369318 L38.1588068,3.60369318 L38.1588068,4.71590909 L38.2355114,4.71590909 C38.3860795,4.34943182 38.6268466,4.05823864 38.9578125,3.84232955 C39.2887784,3.62642045 39.6985795,3.51846591 40.1872159,3.51846591 C40.6389205,3.51846591 41.0330966,3.61505682 41.3697443,3.80823864 C41.706392,4.00142045 41.9677557,4.28125 42.1538352,4.64772727 C42.3399148,5.01420455 42.4315341,5.45880682 42.4286932,5.98153409 L42.4286932,10.1491477 L40.8860795,10.1491477 L40.8860795,6.22017045 C40.8860795,5.78267045 40.7731534,5.44034091 40.5473011,5.19318182 C40.3214489,4.94602273 40.0096591,4.82244318 39.6119318,4.82244318 C39.3420455,4.82244318 39.1026989,4.88139205 38.893892,4.99928977 C38.6850852,5.1171875 38.521733,5.28693182 38.4038352,5.50852273 C38.2859375,5.73011364 38.2269886,5.99857955 38.2269886,6.31392045 Z M56.1664773,3.51846591 C56.6977273,3.51846591 57.168608,3.61576705 57.5791193,3.81036932 C57.9896307,4.00497159 58.3170455,4.27911932 58.5613636,4.6328125 C58.8056818,4.98650568 58.9448864,5.39914773 58.9789773,5.87073864 L57.5045455,5.87073864 C57.4448864,5.55539773 57.3035511,5.29190341 57.0805398,5.08025568 C56.8575284,4.86860795 56.5599432,4.76278409 56.1877841,4.76278409 C55.8724432,4.76278409 55.5954545,4.84730114 55.3568182,5.01633523 C55.1181818,5.18536932 54.9328125,5.42755682 54.8007102,5.74289773 C54.668608,6.05823864 54.6025568,6.43607955 54.6025568,6.87642045 C54.6025568,7.32244318 54.6678977,7.70525568 54.7985795,8.02485795 C54.9292614,8.34446023 55.1132102,8.59019886 55.3504261,8.76207386 C55.587642,8.93394886 55.8667614,9.01988636 56.1877841,9.01988636 C56.4150568,9.01988636 56.618892,8.9765625 56.7992898,8.88991477 C56.9796875,8.80326705 57.1309659,8.67755682 57.253125,8.51278409 C57.3752841,8.34801136 57.4590909,8.14772727 57.5045455,7.91193182 L58.9789773,7.91193182 C58.9420455,8.375 58.8056818,8.78480114 58.5698864,9.14133523 C58.3340909,9.49786932 58.0130682,9.77627841 57.6068182,9.9765625 C57.2005682,10.1768466 56.7232955,10.2769886 56.175,10.2769886 C55.5215909,10.2769886 54.9612216,10.1335227 54.493892,9.84659091 C54.0265625,9.55965909 53.6671875,9.16264205 53.415767,8.65553977 C53.1643466,8.1484375 53.0386364,7.56392045 53.0386364,6.90198864 C53.0386364,6.23721591 53.1664773,5.64985795 53.4221591,5.13991477 C53.6778409,4.62997159 54.0393466,4.23224432 54.5066761,3.94673295 C54.9740057,3.66122159 55.5272727,3.51846591 56.1664773,3.51846591 Z M47.6369318,1.421875 L49.771875,5.28267045 L49.8571023,5.28267045 L51.9920455,1.421875 L53.7775568,1.421875 L50.6028409,6.89346591 L50.6028409,10.1491477 L49.0261364,10.1491477 L49.0261364,6.89346591 L45.8514205,1.421875 L47.6369318,1.421875 Z M62.8039773,10.2769886 C62.1647727,10.2769886 61.6107955,10.1363636 61.1420455,9.85511364 C60.6732955,9.57386364 60.3103693,9.18039773 60.053267,8.67471591 C59.7961648,8.16903409 59.6676136,7.578125 59.6676136,6.90198864 C59.6676136,6.22585227 59.7961648,5.63352273 60.053267,5.125 C60.3103693,4.61647727 60.6732955,4.22159091 61.1420455,3.94034091 C61.6107955,3.65909091 62.1647727,3.51846591 62.8039773,3.51846591 C63.4431818,3.51846591 63.9971591,3.65909091 64.4659091,3.94034091 C64.9346591,4.22159091 65.2975852,4.61647727 65.5546875,5.125 C65.8117898,5.63352273 65.9403409,6.22585227 65.9403409,6.90198864 C65.9403409,7.578125 65.8117898,8.16903409 65.5546875,8.67471591 C65.2975852,9.18039773 64.9346591,9.57386364 64.4659091,9.85511364 C63.9971591,10.1363636 63.4431818,10.2769886 62.8039773,10.2769886 Z M62.8125,9.04119318 C63.1590909,9.04119318 63.4488636,8.9453125 63.6818182,8.75355114 C63.9147727,8.56178977 64.0887784,8.30397727 64.2038352,7.98011364 C64.318892,7.65625 64.3764205,7.29545455 64.3764205,6.89772727 C64.3764205,6.49715909 64.318892,6.13423295 64.2038352,5.80894886 C64.0887784,5.48366477 63.9147727,5.22443182 63.6818182,5.03125 C63.4488636,4.83806818 63.1590909,4.74147727 62.8125,4.74147727 C62.4573864,4.74147727 62.162642,4.83806818 61.928267,5.03125 C61.693892,5.22443182 61.5191761,5.48366477 61.4041193,5.80894886 C61.2890625,6.13423295 61.2315341,6.49715909 61.2315341,6.89772727 C61.2315341,7.29545455 61.2890625,7.65625 61.4041193,7.98011364 C61.5191761,8.30397727 61.693892,8.56178977 61.928267,8.75355114 C62.162642,8.9453125 62.4573864,9.04119318 62.8125,9.04119318 Z M69.3732955,10.2642045 C68.8590909,10.2642045 68.3988636,10.1321023 67.9926136,9.86789773 C67.5863636,9.60369318 67.2653409,9.22017045 67.0295455,8.71732955 C66.79375,8.21448864 66.6758523,7.60369318 66.6758523,6.88494318 C66.6758523,6.15767045 66.7958807,5.54332386 67.0359375,5.04190341 C67.2759943,4.54048295 67.6005682,4.16122159 68.0096591,3.90411932 C68.41875,3.64701705 68.8747159,3.51846591 69.3775568,3.51846591 C69.7610795,3.51846591 70.0764205,3.58309659 70.3235795,3.71235795 C70.5707386,3.84161932 70.7667614,3.99644886 70.9116477,4.17684659 C71.0565341,4.35724432 71.16875,4.52698864 71.2482955,4.68607955 L71.3122159,4.68607955 L71.3122159,1.421875 L72.8590909,1.421875 L72.8590909,10.1491477 L71.3420455,10.1491477 L71.3420455,9.11789773 L71.2482955,9.11789773 C71.16875,9.27698864 71.0536932,9.4453125 70.903125,9.62286932 C70.7525568,9.80042614 70.5536932,9.95170455 70.3065341,10.0767045 C70.059375,10.2017045 69.7482955,10.2642045 69.3732955,10.2642045 Z M69.8036932,8.99857955 C70.1303977,8.99857955 70.4088068,8.90980114 70.6389205,8.73224432 C70.8690341,8.5546875 71.04375,8.30681818 71.1630682,7.98863636 C71.2823864,7.67045455 71.3420455,7.29971591 71.3420455,6.87642045 C71.3420455,6.453125 71.2830966,6.08522727 71.1651989,5.77272727 C71.0473011,5.46022727 70.8740057,5.21732955 70.6453125,5.04403409 C70.4166193,4.87073864 70.1360795,4.78409091 69.8036932,4.78409091 C69.4599432,4.78409091 69.1730114,4.87357955 68.9428977,5.05255682 C68.7127841,5.23153409 68.5394886,5.47869318 68.4230114,5.79403409 C68.3065341,6.109375 68.2482955,6.47017045 68.2482955,6.87642045 C68.2482955,7.28551136 68.3072443,7.64985795 68.425142,7.96946023 C68.5430398,8.2890625 68.7177557,8.54048295 68.9492898,8.72372159 C69.1808239,8.90696023 69.465625,8.99857955 69.8036932,8.99857955 Z M77.1059659,10.2769886 C76.4497159,10.2769886 75.8836648,10.1399148 75.4078125,9.86576705 C74.9319602,9.59161932 74.5661932,9.20241477 74.3105114,8.69815341 C74.0548295,8.19389205 73.9269886,7.59943182 73.9269886,6.91477273 C73.9269886,6.24147727 74.0555398,5.64985795 74.312642,5.13991477 C74.5697443,4.62997159 74.9298295,4.23224432 75.3928977,3.94673295 C75.8559659,3.66122159 76.4,3.51846591 77.025,3.51846591 C77.4284091,3.51846591 77.8098011,3.58309659 78.1691761,3.71235795 C78.5285511,3.84161932 78.846733,4.04119318 79.1237216,4.31107955 C79.4007102,4.58096591 79.61875,4.92400568 79.7778409,5.34019886 C79.9369318,5.75639205 80.0164773,6.25142045 80.0164773,6.82528409 L80.0164773,7.29829545 L74.6514205,7.29829545 L74.6514205,6.25852273 L78.5377841,6.25852273 C78.5349432,5.96306818 78.4710227,5.69957386 78.3460227,5.46803977 C78.2210227,5.23650568 78.047017,5.05397727 77.8240057,4.92045455 C77.6009943,4.78693182 77.3417614,4.72017045 77.0463068,4.72017045 C76.7309659,4.72017045 76.4539773,4.79616477 76.2153409,4.94815341 C75.9767045,5.10014205 75.7913352,5.29900568 75.659233,5.54474432 C75.5271307,5.79048295 75.4596591,6.05965909 75.4568182,6.35227273 L75.4568182,7.25994318 C75.4568182,7.640625 75.5264205,7.96661932 75.665625,8.23792614 C75.8048295,8.50923295 75.9994318,8.71661932 76.2494318,8.86008523 C76.4994318,9.00355114 76.7920455,9.07528409 77.1272727,9.07528409 C77.3517045,9.07528409 77.5548295,9.04332386 77.7366477,8.97940341 C77.9184659,8.91548295 78.0761364,8.82102273 78.2096591,8.69602273 C78.3431818,8.57102273 78.4440341,8.41619318 78.5122159,8.23153409 L79.9525568,8.39346591 C79.8616477,8.77414773 79.6890625,9.10582386 79.4348011,9.38849432 C79.1805398,9.67116477 78.8559659,9.88991477 78.4610795,10.0447443 C78.0661932,10.1995739 77.6144886,10.2769886 77.1059659,10.2769886 Z"
              fill="#FFFFFF"
              fillRule="nonzero"
            />
          </svg>
        </a>
      )}
    </>
  );
}
