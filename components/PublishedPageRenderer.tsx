import { Fragment } from 'react';
import { preload } from 'react-dom';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import LightboxInitializer from '@/components/LightboxInitializer';
import PasswordForm from '@/components/PasswordForm';
import SliderInitializer from '@/components/SliderInitializer';
import StudioRevealInitializer, { type StudioRevealTarget } from '@/components/StudioRevealInitializer';
import StudioRuntimeInitializer from '@/components/StudioRuntimeInitializer';
import { collectLayerAssetIds, getAssetProxyUrl } from '@/lib/asset-utils';
import { generateInitialAnimationCSS } from '@/lib/animation-utils';
import { parseSafeBodyStyle } from '@/lib/body-style';
import { castValue } from '@/lib/collection-utils';
import { buildCustomFontsCss, buildFontClassesCss, filterGoogleFontLinksAgainstHeadHtml, getGoogleFontLinks, removeDuplicateGoogleFontLinksFromHeadHtml } from '@/lib/font-utils';
import { getClassesString } from '@/lib/layer-utils';
import { REF_COLLECTION_PREFIX, REF_PAGE_PREFIX, isCollectionItemKeyword } from '@/lib/link-utils';
import { canRenderStudioCustomCode } from '@/lib/studio-platform';
import { renderPageLayersToHtml } from '@/lib/page-fetcher';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { extractPriorityImagePreload } from '@/lib/published-image-preload';
import { resolveCustomCodePlaceholders } from '@/lib/resolve-cms-variables';
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
  LayerInteraction,
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

const FORM_RESET_CSS = 'input,select,textarea{appearance:none;-webkit-appearance:none}select{background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23737373\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;background-size:16px 16px}input[type="checkbox"]:checked,input[type="radio"]:checked{background-color:currentColor;border-color:transparent;background-size:100% 100%;background-position:center;background-repeat:no-repeat}input[type="checkbox"]:checked{background-image:url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3cpath d=\'M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z\'/%3e%3c/svg%3e")}input[type="radio"]:checked{background-image:url("data:image/svg+xml,%3csvg viewBox=\'0 0 16 16\' fill=\'white\' xmlns=\'http://www.w3.org/2000/svg\'%3e%3ccircle cx=\'8\' cy=\'8\' r=\'3\'/%3e%3c/svg%3e")}';

const PAGE_TRANSITION_CSS = [
  '@keyframes ycode-studio-page-transition{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}',
  '@media (prefers-reduced-motion:no-preference){[data-studio-page-transition]{opacity:0;transform:translateY(20px);animation:ycode-studio-page-transition 700ms cubic-bezier(0.16,1,0.3,1) forwards}}',
  '@media (prefers-reduced-motion:reduce){[data-studio-page-transition]{opacity:1;transform:none;animation:none}}',
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

function collectPublishedAnimationRuntime(layers: Layer[]): {
  revealTargets: StudioRevealTarget[];
  requiresGsap: boolean;
} {
  const revealTargets: StudioRevealTarget[] = [];
  let requiresGsap = false;

  const isStudioRuntimeHandledInteraction = (layer: Layer): boolean => (
    layer.attributes?.['data-studio-mobile-drawer-trigger'] !== undefined
    || layer.attributes?.['data-studio-import-interaction'] === 'mobile-drawer'
  );

  const scanInteraction = (layer: Layer, interaction: LayerInteraction) => {
    if (isStudioRuntimeHandledInteraction(layer)) {
      return;
    }

    const studioInteraction = interaction as LayerInteraction & { studioImportReveal?: boolean };
    const isSimpleStudioReveal = studioInteraction.studioImportReveal === true
      && interaction.trigger === 'scroll-into-view'
      && (interaction.timeline?.toggleActions ?? 'play none none none') === 'play none none none'
      && (interaction.timeline?.scrub === undefined || interaction.timeline.scrub === false)
      && !interaction.timeline?.yoyo
      && (interaction.timeline?.repeat ?? 0) === 0
      && Array.isArray(interaction.tweens)
      && interaction.tweens.every((tween) => (
        !tween.splitText
        && tween.apply_styles?.autoAlpha === 'on-load'
        && tween.apply_styles?.y === 'on-load'
      ));

    if (!isSimpleStudioReveal) {
      requiresGsap = true;
      return;
    }

    interaction.tweens.forEach((tween) => {
      revealTargets.push({
        layerId: tween.layer_id,
        durationMs: Number.isFinite(Number(tween.duration)) ? Number(tween.duration) * 1000 : undefined,
        delayMs: typeof tween.position === 'number' ? tween.position * 1000 : undefined,
        y: Number.isFinite(Number(tween.from?.y)) ? Number(tween.from?.y) : undefined,
        breakpoints: interaction.timeline?.breakpoints,
      });
    });
  };

  const scan = (layerList: Layer[]) => {
    layerList.forEach((layer) => {
      layer.interactions?.forEach((interaction) => scanInteraction(layer, interaction));
      if (Array.isArray(layer.children)) scan(layer.children);
    });
  };

  scan(layers);
  return { revealTargets, requiresGsap };
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
  translations,
  gaMeasurementId,
  globalCustomCodeHead,
  globalCustomCodeBody,
  ycodeBadge = false,
  passwordProtection,
}: PublishedPageRendererProps) {
  const pageRenderProjectId = getRenderProjectId(page);
  const renderProjectId = explicitRenderProjectId || pageRenderProjectId;
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
    [pages, folders] = await Promise.all([
      (renderProjectId || isProjectScopeRequired()) ? getRenderPages(renderProjectId, renderIsPublished) : getAllPages(),
      (renderProjectId || isProjectScopeRequired()) ? getRenderPageFolders(renderProjectId, renderIsPublished) : getAllPageFolders(),
    ]);

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
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }

    const refTargetCollectionIds = new Set(
      allPageLinks
        .filter(l => l.collection_item_id.startsWith(REF_PAGE_PREFIX) || l.collection_item_id.startsWith(REF_COLLECTION_PREFIX))
        .map(l => pages.find(p => p.id === l.page_id)?.settings?.cms?.collection_id)
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
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }
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
  let googleFontLinkUrls: string[] = [];
  try {
    const { getPublishedFonts } = await import('@/lib/repositories/fontRepository');
    const fonts = (renderProjectId || isProjectScopeRequired())
      ? await getRenderFonts(renderProjectId)
      : await getPublishedFonts();
    fontsCss = buildCustomFontsCss(fonts) + buildFontClassesCss(fonts);
    googleFontLinkUrls = filterGoogleFontLinksAgainstHeadHtml(
      getGoogleFontLinks(fonts),
      dedupedGlobalCustomCodeHead,
      dedupedPageCustomCodeHead,
    );
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
      assetMap = (renderProjectId || isProjectScopeRequired())
        ? await getRenderAssetsByIds(Array.from(layerAssetIds), renderProjectId)
        : await getAssetsByIds(Array.from(layerAssetIds), true);
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
  const { css: initialAnimationCSS } = generateInitialAnimationCSS(resolvedLayers);
  const animationRuntime = collectPublishedAnimationRuntime(childLayers);
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

      {googleFontLinkUrls.map((url, i) => (
        <Fragment key={`gfont-${i}`}>
          <link
            rel="preload" as="style"
            href={url}
          />
          <script dangerouslySetInnerHTML={{ __html: fontStylesheetLoaderScript(url) }} />
          <noscript dangerouslySetInnerHTML={{ __html: `<link rel="stylesheet" href="${url.replace(/"/g, '&quot;')}">` }} />
        </Fragment>
      ))}

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
      {needsStudioRuntime && <StudioRuntimeInitializer />}
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
