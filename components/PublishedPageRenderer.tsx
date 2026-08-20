import { Fragment } from 'react';
import { preload } from 'react-dom';
import { unstable_cache } from 'next/cache';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import LightboxInitializer from '@/components/LightboxInitializer';
import PasswordForm from '@/components/PasswordForm';
import PublishedGsapInitializer from '@/components/PublishedGsapInitializer';
import SliderInitializer from '@/components/SliderInitializer';
import StudioRevealInitializer from '@/components/StudioRevealInitializer';
import DeferredStudioRuntimeInitializer from '@/components/DeferredStudioRuntimeInitializer';
import { FORM_RESET_CSS } from '@/components/form-reset-css';
import { collectLayerAssetIds, getAssetProxyUrl } from '@/lib/asset-utils';
import { generateInitialAnimationCSS } from '@/lib/animation-utils';
import { parseSafeBodyStyle } from '@/lib/body-style';
import { castValue } from '@/lib/collection-utils';
import { buildCustomFontsCss, buildFontClassesCss, filterGoogleFontLinksAgainstHeadHtml, getGoogleFontLinks, removeDuplicateGoogleFontLinksFromHeadHtml } from '@/lib/font-utils';
import { getClassesString } from '@/lib/layer-utils';
import { collectPublishedAnimationRuntime } from '@/lib/published-animation-runtime';
import { REF_COLLECTION_PREFIX, REF_PAGE_PREFIX, isCollectionItemKeyword } from '@/lib/link-utils';
import { canRenderStudioCustomCode } from '@/lib/studio-platform';
import { renderPageLayersToHtml } from '@/lib/page-fetcher';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { extractPriorityImagePreload } from '@/lib/published-image-preload';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
import { getInlinedGoogleFontsCss } from '@/lib/server/googleFontsInline';
import {
  buildPublishedDataCacheKey,
  buildPublishedDataCacheTags,
} from '@/lib/server/publishedPageDataCache';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { SUPABASE_QUERY_LIMIT } from '@/lib/supabase-constants';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getItemWithValues, getItemsWithValues } from '@/lib/repositories/collectionItemRepository';
import type {
  Asset,
  CollectionField,
  CollectionItemWithValues,
  Component,
  Font,
  Layer,
  Locale,
  Page,
  PageFolder,
} from '@/types';

type PasswordProtectionContext = {
  pageId?: string;
  folderId?: string;
  redirectUrl: string;
  isPublished: boolean;
};

interface PublishedPageRendererProps {
  page: Page;
  layers: Layer[];
  components: Component[];
  generatedCss?: string;
  colorVariablesCss?: string;
  collectionItem?: CollectionItemWithValues;
  collectionFields?: CollectionField[];
  pageCollectionSortedItemIds?: string[];
  pageCollectionSortedItemSlugs?: Record<string, string>;
  locale?: Locale | null;
  availableLocales?: Locale[];
  renderProjectId?: string | null;
  customCodeProjectId?: string | null;
  /** Enables cross-request caching only for non-pagination published routes. */
  publishedRoutePath?: string;
  translations?: Record<string, any> | null;
  gaMeasurementId?: string | null;
  globalCustomCodeHead?: string | null;
  globalCustomCodeBody?: string | null;
  ycodeBadge?: boolean;
  passwordProtection?: PasswordProtectionContext;
}

interface PageLinkRef {
  collection_item_id: string;
  page_id: string;
}

const PAGE_TRANSITION_CSS = [
  '@keyframes ycode-studio-page-transition{from{transform:translateY(12px)}to{transform:translateY(0)}}',
  '@media (prefers-reduced-motion:no-preference) and (min-width:768px){[data-studio-page-transition]{opacity:1;will-change:transform;animation:ycode-studio-page-transition 360ms cubic-bezier(0.16,1,0.3,1) both}}',
  '@media (max-width:767px),(prefers-reduced-motion:reduce){[data-studio-page-transition]{opacity:1;transform:none;animation:none}}',
].join('');

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function escapeStyleBoundary(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function fontStylesheetLoaderScript(url: string): string {
  return `(function(){var href=${scriptJson(url)};if(document.querySelector('link[data-ycode-font-href="'+href.replace(/"/g,'\\"')+'"]'))return;var l=document.createElement('link');l.rel='stylesheet';l.href=href;l.dataset.ycodeFontHref=href;document.head.appendChild(l);})()`;
}

function safeGaMeasurementId(value?: string | null): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^(G|GT|UA|AW|DC)-[A-Z0-9-]+$/i.test(trimmed) ? trimmed : null;
}

function safeBodyClassList(classes: string): string[] {
  const classList = (classes || 'bg-white')
    .split(/\s+/)
    .map((className) => className.trim())
    .filter((className) => className.length > 0 && !/[<>"'=&]/.test(className));
  return classList.length > 0 ? classList : ['bg-white'];
}

function bodyStyleForSsr(style: string): string {
  return parseSafeBodyStyle(style)
    .map(({ prop, value, priority }) => `${prop}:${value}${priority ? ' !important' : ''}`)
    .join(';');
}

function bodyBootstrapScript(classes: string, style: string): string {
  const classList = safeBodyClassList(classes);
  const styleDeclarations = parseSafeBodyStyle(style);
  return `(function(){var next=${scriptJson(classList)};var decls=${scriptJson(styleDeclarations)};function apply(){var b=document.body;if(!b)return;var prev=(b.dataset.ycodeAppliedBodyClasses||'').split(/\\s+/).filter(Boolean);if(prev.length)b.classList.remove.apply(b.classList,prev);if(b.classList.contains('text-xs'))b.dataset.ycodeRemovedShellTextXs='true';b.classList.remove('text-xs');if(next.length)b.classList.add.apply(b.classList,next);b.dataset.ycodeAppliedBodyClasses=next.join(' ');var prevProps=(b.dataset.ycodeAppliedBodyStyleProps||'').split(',').filter(Boolean);prevProps.forEach(function(prop){b.style.removeProperty(prop)});var snap={};decls.forEach(function(d){var value=b.style.getPropertyValue(d.prop);var priority=b.style.getPropertyPriority(d.prop);snap[d.prop]={value:value,priority:priority,hadValue:value!==''||priority!==''};b.style.setProperty(d.prop,d.value,d.priority||'')});b.dataset.ycodeAppliedBodyStyleProps=decls.map(function(d){return d.prop}).join(',');b.dataset.ycodeBootstrapBodyStyleSnapshot=JSON.stringify(snap)}if(document.body)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});})()`;
}

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
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) results.push(...collectTiptapPageLinks(child));
  }
  return results;
}

function collectLayerPageLinks(layers: Layer[]): PageLinkRef[] {
  const results: PageLinkRef[] = [];
  const scan = (layer: Layer) => {
    if (layer.variables?.link?.type === 'page') {
      const { collection_item_id, id: page_id } = layer.variables.link.page ?? {};
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

function extractCollectionItemSlugs(layers: Layer[]): Record<string, string> {
  const slugs: Record<string, string> = {};
  const scan = (layer: Layer) => {
    if (layer._collectionItemId && layer._collectionItemSlug) {
      slugs[layer._collectionItemId] = layer._collectionItemSlug;
    }
    if (layer.children) layer.children.forEach(scan);
  };
  layers.forEach(scan);
  return slugs;
}

function extractBodyLayer(layers: Layer[]): {
  hasBodyLayer: boolean;
  bodyClasses: string;
  bodyStyle: string;
  bodyAttributes: Record<string, unknown>;
  childLayers: Layer[];
} {
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

function hasNamedLayer(layers: Layer[], name: string): boolean {
  for (const layer of layers) {
    if (layer.name === name) return true;
    if (layer.children && hasNamedLayer(layer.children, name)) return true;
  }
  return false;
}

function hasStudioPageTransition(layers: Layer[]): boolean {
  const scan = (layer: Layer): boolean => {
    if (layer.attributes?.['data-studio-page-transition'] !== undefined) return true;
    return Array.isArray(layer.children) && layer.children.some(scan);
  };
  return layers.some(scan);
}

function getRenderProjectId(page: Page): string | null {
  const pageWithProject = page as Page & { project_id?: unknown };
  const settings = page.settings as (Page['settings'] & { studio_import?: Record<string, unknown> }) | undefined;
  const candidates = [
    pageWithProject.project_id,
    settings?.studio_import?.applied_project_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate)) {
      return candidate;
    }
  }
  return null;
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
  if (isMissingColumnError(error)) {
    return false;
  }
  throw new Error(`Failed to inspect project scope for ${tableName}: ${error.message}`);
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
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  valuesQuery = applyRenderProjectScopeToBuilder(valuesQuery, 'collection_item_values', projectId, await renderTableHasProjectScope(client, 'collection_item_values'));
  const { data: valuesData, error: valuesError } = await valuesQuery;
  if (valuesError) throw new Error(`Failed to fetch render collection item values: ${valuesError.message}`);

  const values: Record<string, any> = {};
  valuesData?.forEach((row: any) => {
    if (!row.field_id) return;
    values[row.field_id] = castValue(row.value, row.collection_fields?.type || 'text');
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
    valuesByItem[row.item_id] ||= {};
    valuesByItem[row.item_id][row.field_id] = castValue(row.value, row.collection_fields?.type || 'text');
  });
  return {
    items: items.map((item: any) => ({ ...item, values: valuesByItem[item.id] || {} })),
  };
}

async function getRenderFonts(projectId: string | null): Promise<Font[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  let query = client
    .from('fonts')
    .select('*')
    .eq('is_published', true)
    .is('deleted_at', null);
  query = applyRenderProjectScopeToBuilder(query, 'fonts', projectId, await renderTableHasProjectScope(client, 'fonts'));
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(SUPABASE_QUERY_LIMIT);
  if (error) throw new Error(`Failed to fetch render fonts: ${error.message}`);
  return data || [];
}

async function getRenderAssetsByIds(ids: string[], projectId: string | null): Promise<Record<string, Asset>> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase not configured');
  if (ids.length === 0) return {};
  let query = client
    .from('assets')
    .select('*')
    .eq('is_published', true)
    .in('id', ids);
  query = applyRenderProjectScopeToBuilder(query, 'assets', projectId, await renderTableHasProjectScope(client, 'assets'));
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch render assets: ${error.message}`);
  const assets: Record<string, Asset> = {};
  for (const asset of data || []) {
    const proxyUrl = getAssetProxyUrl(asset as Asset);
    assets[asset.id] = { ...asset, public_url: proxyUrl || asset.public_url };
  }
  return assets;
}

async function loadPublishedRendererData<T>(
  load: () => Promise<T>,
  input: {
    projectId: string | null;
    pageId: string;
    routePath?: string;
    locale: string;
    scope: string;
  },
): Promise<T> {
  if (!input.routePath) return load();

  try {
    return await unstable_cache(
      async () => load(),
      buildPublishedDataCacheKey({
        projectId: input.projectId,
        routePath: input.routePath,
        pageId: input.pageId,
        locale: input.locale,
        scope: `renderer-${input.scope}`,
      }),
      {
        tags: buildPublishedDataCacheTags(input.projectId, input.routePath),
        revalidate: false,
      },
    )();
  } catch {
    return load();
  }
}

export default async function PublishedPageRenderer({
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
  renderProjectId: explicitRenderProjectId = null,
  customCodeProjectId: explicitCustomCodeProjectId = null,
  publishedRoutePath,
  translations,
  gaMeasurementId,
  globalCustomCodeHead,
  globalCustomCodeBody,
  ycodeBadge = false,
  passwordProtection,
}: PublishedPageRendererProps) {
  const pageRenderProjectId = getRenderProjectId(page);
  const renderProjectId = explicitRenderProjectId || pageRenderProjectId;
  const publishedCacheLocale = locale?.code
    || availableLocales.find((availableLocale) => availableLocale.is_default)?.code
    || 'default';
  const publishedRendererCacheInput = {
    projectId: renderProjectId,
    pageId: page.id,
    routePath: publishedRoutePath,
    locale: publishedCacheLocale,
  };
  const resolvedLayers = layers || [];
  const { hasBodyLayer, bodyClasses, bodyStyle, bodyAttributes, childLayers } = extractBodyLayer(resolvedLayers);
  const appliedBodyClasses = bodyClasses || 'bg-white';
  const appliedBodyStyle = bodyStyle || '';
  const runtimeProfile = typeof bodyAttributes['data-studio-runtime-profile'] === 'string'
    ? bodyAttributes['data-studio-runtime-profile']
    : undefined;
  const runtimeAdapters = typeof bodyAttributes['data-studio-runtime-adapters'] === 'string'
    ? bodyAttributes['data-studio-runtime-adapters']
    : undefined;

  const allPageLinks = collectLayerPageLinks(resolvedLayers);
  const referencedItemIds = new Set(
    allPageLinks
      .filter(l => !isCollectionItemKeyword(l.collection_item_id) && !l.collection_item_id.startsWith('ref-'))
      .map(l => l.collection_item_id)
  );
  const collectionItemSlugs: Record<string, string> = {
    ...extractCollectionItemSlugs(resolvedLayers),
    ...(pageCollectionSortedItemSlugs || {}),
  };
  if (collectionItem && collectionFields) {
    const slugField = collectionFields.find(f => f.key === 'slug');
    if (slugField && collectionItem.values[slugField.id]) {
      collectionItemSlugs[collectionItem.id] = collectionItem.values[slugField.id];
    }
  }

  const renderIsPublished = true;
  let pages: Page[] = [];
  let folders: PageFolder[] = [];
  try {
    const linkResolutionData = await loadPublishedRendererData(async () => {
      const [loadedPages, loadedFolders] = await Promise.all([
        (renderProjectId || isProjectScopeRequired()) ? getRenderPages(renderProjectId, renderIsPublished) : getAllPages(),
        (renderProjectId || isProjectScopeRequired()) ? getRenderPageFolders(renderProjectId, renderIsPublished) : getAllPageFolders(),
      ]);
      const supplementalSlugs: Record<string, string> = {};

      if (referencedItemIds.size > 0) {
        const itemsWithValues = await Promise.all(
          Array.from(referencedItemIds).map(itemId => (
            (renderProjectId || isProjectScopeRequired())
              ? getRenderItemWithValues(itemId, renderIsPublished, renderProjectId)
              : getItemWithValues(itemId, renderIsPublished)
          ))
        );
        for (const item of itemsWithValues) {
          if (!item) continue;
          const fields = (renderProjectId || isProjectScopeRequired())
            ? await getRenderFieldsByCollectionId(item.collection_id, renderIsPublished, renderProjectId)
            : await getFieldsByCollectionId(item.collection_id, renderIsPublished);
          const slugField = fields.find(f => f.key === 'slug');
          if (slugField && item.values[slugField.id]) {
            supplementalSlugs[item.id] = item.values[slugField.id];
          }
        }
      }

      const refTargetCollectionIds = new Set(
        allPageLinks
          .filter(l => l.collection_item_id.startsWith(REF_PAGE_PREFIX) || l.collection_item_id.startsWith(REF_COLLECTION_PREFIX))
          .map(l => loadedPages.find(p => p.id === l.page_id)?.settings?.cms?.collection_id)
          .filter((id): id is string => Boolean(id))
      );
      for (const collectionId of refTargetCollectionIds) {
        const fields = (renderProjectId || isProjectScopeRequired())
          ? await getRenderFieldsByCollectionId(collectionId, renderIsPublished, renderProjectId)
          : await getFieldsByCollectionId(collectionId, renderIsPublished);
        const slugField = fields.find(f => f.key === 'slug');
        if (!slugField) continue;
        const { items } = (renderProjectId || isProjectScopeRequired())
          ? await getRenderItemsWithValues(collectionId, renderIsPublished, renderProjectId)
          : await getItemsWithValues(collectionId, renderIsPublished);
        for (const item of items) {
          if (item.values[slugField.id]) {
            supplementalSlugs[item.id] = item.values[slugField.id];
          }
        }
      }

      return { pages: loadedPages, folders: loadedFolders, supplementalSlugs };
    }, { ...publishedRendererCacheInput, scope: 'link-data' });

    pages = linkResolutionData.pages;
    folders = linkResolutionData.folders;
    Object.assign(collectionItemSlugs, linkResolutionData.supplementalSlugs);
  } catch (error) {
    console.error('[PublishedPageRenderer] Error fetching link resolution data:', error);
    if (isProjectScopeRequired()) throw error;
  }

  const dedupedGlobalCustomCodeHead = removeDuplicateGoogleFontLinksFromHeadHtml(globalCustomCodeHead || '');
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
  const allowCustomCodeExecution = await canRenderStudioCustomCode(customCodeRenderProjectId, true, {
    requireProject: isProjectScopeRequired() || Boolean(process.env.STUDIO_YCODE_SITE_KEY && process.env.STUDIO_YCODE_SITE_KEY !== 'default'),
  });

  let fontsCss = '';
  let googleFontsInlinedCss = '';
  let googleFontLinkUrls: string[] = [];
  try {
    const { getPublishedFonts } = await import('@/lib/repositories/fontRepository');
    const fonts = await loadPublishedRendererData(
      async () => (renderProjectId || isProjectScopeRequired())
        ? getRenderFonts(renderProjectId)
        : getPublishedFonts(),
      { ...publishedRendererCacheInput, scope: 'fonts' },
    );
    fontsCss = buildCustomFontsCss(fonts) + buildFontClassesCss(fonts);
    googleFontLinkUrls = filterGoogleFontLinksAgainstHeadHtml(
      getGoogleFontLinks(fonts),
      dedupedGlobalCustomCodeHead,
      dedupedPageCustomCodeHead,
    );
    googleFontsInlinedCss = await getInlinedGoogleFontsCss(googleFontLinkUrls);
  } catch (error) {
    console.error('[PublishedPageRenderer] Error loading fonts:', error);
    if (isProjectScopeRequired()) throw error;
  }

  let assetMap: Record<string, Asset> = {};
  const layerAssetIds = collectLayerAssetIds(resolvedLayers, components);
  if (collectionItem) {
    for (const value of Object.values(collectionItem.values)) {
      if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        layerAssetIds.add(value);
      }
    }
  }
  if (layerAssetIds.size > 0) {
    try {
      const { getAssetsByIds } = await import('@/lib/repositories/assetRepository');
      assetMap = await loadPublishedRendererData(
        async () => (renderProjectId || isProjectScopeRequired())
          ? getRenderAssetsByIds(Array.from(layerAssetIds), renderProjectId)
          : getAssetsByIds(Array.from(layerAssetIds), true),
        { ...publishedRendererCacheInput, scope: 'assets' },
      );
      for (const [id, asset] of Object.entries(assetMap)) {
        const proxyUrl = getAssetProxyUrl(asset);
        if (proxyUrl) {
          assetMap[id] = { ...asset, public_url: proxyUrl };
        }
      }
    } catch (error) {
      console.error('[PublishedPageRenderer] Error fetching assets:', error);
      if (isProjectScopeRequired()) throw error;
    }
  }

  const html = await renderPageLayersToHtml({
    layers: childLayers,
    pages,
    folders,
    collectionItemId: collectionItem?.id,
    collectionItemData: collectionItem?.values,
    pageCollectionItemData: collectionItem?.values,
    pageCollectionSortedItemIds,
    collectionItemSlugs,
    locale,
    translations: translations || undefined,
    assetMap,
    components,
    isPreview: false,
  });
  const priorityImagePreload = extractPriorityImagePreload(html);
  if (priorityImagePreload) {
    preload(priorityImagePreload.href, {
      as: 'image',
      fetchPriority: 'high',
      imageSrcSet: priorityImagePreload.imageSrcSet,
      imageSizes: priorityImagePreload.imageSizes,
    });
  }

  const ssrBodyStyle = bodyStyleForSsr(appliedBodyStyle);
  const safeGaId = safeGaMeasurementId(gaMeasurementId);
  const hasLayers = childLayers.length > 0;
  const hasPageTransition = hasStudioPageTransition(childLayers);
  const animationRuntime = collectPublishedAnimationRuntime(resolvedLayers);
  const { css: initialAnimationCSS } = generateInitialAnimationCSS(resolvedLayers, {
    skipLayerIds: new Set(animationRuntime.revealTargets.map((target) => target.layerId)),
  });
  const needsStudioRuntime = Boolean(runtimeAdapters);

  return (
    <>
      {allowCustomCodeExecution && process.env.SKIP_SETUP === 'true' && dedupedGlobalCustomCodeHead && (
        renderRootLayoutHeadCode(dedupedGlobalCustomCodeHead, 'global-head')
      )}
      {allowCustomCodeExecution && dedupedPageCustomCodeHead && renderRootLayoutHeadCode(dedupedPageCustomCodeHead, 'page-head')}

      <style id="ycode-form-reset" dangerouslySetInnerHTML={{ __html: FORM_RESET_CSS }} />
      {generatedCss && <style id="ycode-generated-css" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(generatedCss) }} />}
      {colorVariablesCss && <style id="ycode-color-variables" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(colorVariablesCss) }} />}

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
      {googleFontsInlinedCss ? (
        <style
          id="ycode-google-fonts"
          dangerouslySetInnerHTML={{ __html: googleFontsInlinedCss }}
        />
      ) : (
        googleFontLinkUrls.map((url, i) => (
          <Fragment key={`gfont-${i}`}>
            <script dangerouslySetInnerHTML={{ __html: fontStylesheetLoaderScript(url) }} />
            <noscript
              dangerouslySetInnerHTML={{
                __html: `<link rel="stylesheet" href="${url.replace(/"/g, '&quot;')}">`,
              }}
            />
          </Fragment>
        ))
      )}

      {fontsCss && <style id="ycode-fonts" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(fontsCss) }} />}
      {ssrBodyStyle && <style id="ycode-body-layer-style" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(`body{${ssrBodyStyle}}`) }} />}
      <script id="ycode-body-layer-class-bootstrap" dangerouslySetInnerHTML={{ __html: bodyBootstrapScript(appliedBodyClasses, appliedBodyStyle) }} />
      {hasPageTransition && <style id="ycode-studio-page-transition-initial" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(PAGE_TRANSITION_CSS) }} />}
      {initialAnimationCSS && <style id="ycode-gsap-initial-styles" dangerouslySetInnerHTML={{ __html: escapeStyleBoundary(initialAnimationCSS) }} />}

      {allowCustomCodeExecution && safeGaId && (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(safeGaId)}`} />
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

      <main
        id="ybody"
        className="contents"
        data-layer-id="body"
        data-layer-type="div"
        data-is-empty={hasLayers ? 'false' : 'true'}
        data-studio-runtime-profile={runtimeProfile}
        data-studio-runtime-adapters={runtimeAdapters}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {page.error_page === 401 && passwordProtection && (
        <PasswordForm
          pageId={passwordProtection.pageId}
          folderId={passwordProtection.folderId}
          redirectUrl={passwordProtection.redirectUrl}
          isPublished={passwordProtection.isPublished}
        />
      )}

      {animationRuntime.revealTargets.length > 0 && <StudioRevealInitializer targets={animationRuntime.revealTargets} />}
      <PublishedGsapInitializer
        layers={resolvedLayers}
        requiresGsap={animationRuntime.requiresGsap}
      />
      {needsStudioRuntime && <DeferredStudioRuntimeInitializer />}
      {hasNamedLayer(resolvedLayers, 'slider') && <SliderInitializer />}
      {hasNamedLayer(resolvedLayers, 'lightbox') && <LightboxInitializer />}

      {allowCustomCodeExecution && globalCustomCodeBody && <CustomCodeInjector html={globalCustomCodeBody} />}
      {allowCustomCodeExecution && pageCustomCodeBody && <CustomCodeInjector html={pageCustomCodeBody} />}

      {ycodeBadge && (
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
            color: '#fff',
            textDecoration: 'none',
            zIndex: 9999,
            fontFamily: 'system-ui, sans-serif',
            fontSize: '12px',
            lineHeight: '1',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          Studio
        </a>
      )}

      {!hasBodyLayer && (
        <script
          dangerouslySetInnerHTML={{
            __html: `document.body.classList.add('bg-white');`,
          }}
        />
      )}
    </>
  );
}
