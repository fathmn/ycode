import type { Layer } from '@/types';

type ImageLayerLike = Pick<Layer, 'id' | 'name' | 'customName' | 'attributes' | 'classes'>;

const BRAND_IMAGE_SRCSET_WIDTHS = [64, 80, 96, 128, 160];
const CONTENT_IMAGE_SRCSET_WIDTHS = [240, 320, 480, 640, 768, 960, 1280];
const PRIORITY_IMAGE_SRCSET_WIDTHS = [320, 640, 960, 1280, 1600];

function getAttribute(layer: ImageLayerLike, name: string): unknown {
  return layer.attributes?.[name];
}

function layerText(layer: ImageLayerLike): string {
  return [
    layer.id,
    layer.name,
    layer.customName,
    String(getAttribute(layer, 'data-layer-id') || ''),
    String(getAttribute(layer, 'data-studio-import-asset-id') || ''),
  ].join(' ').toLowerCase();
}

function classText(layer: ImageLayerLike): string {
  return Array.isArray(layer.classes) ? layer.classes.join(' ') : layer.classes || '';
}

export function isPriorityImageLayer(layer: ImageLayerLike): boolean {
  const assetId = String(getAttribute(layer, 'data-studio-import-asset-id') || '').toLowerCase();
  const text = layerText(layer);
  return assetId === 'hero' || text.includes('hero-background') || text.includes('hero image');
}

export function isSmallBrandImageLayer(layer: ImageLayerLike): boolean {
  const assetId = String(getAttribute(layer, 'data-studio-import-asset-id') || '').toLowerCase();
  return Boolean(
    assetId === 'logo'
    || getAttribute(layer, 'data-studio-brand-logo')
    || getAttribute(layer, 'data-studio-header-logo')
  );
}

function isFramedContentImageLayer(layer: ImageLayerLike): boolean {
  if (isPriorityImageLayer(layer) || isSmallBrandImageLayer(layer)) return false;

  const classes = classText(layer);
  const text = layerText(layer);

  return Boolean(
    text.includes('welcome-image')
    || text.includes('feature-tab-image')
    || text.includes('about')
    || (
      classes.includes('object-cover')
      && classes.includes('w-full')
      && classes.includes('h-full')
    )
  );
}

export function getImageLoadingAttribute(layer: ImageLayerLike): 'eager' | 'lazy' {
  return isPriorityImageLayer(layer) || isSmallBrandImageLayer(layer) ? 'eager' : 'lazy';
}

export function getImageFetchPriority(layer: ImageLayerLike): 'high' | 'auto' | undefined {
  return isPriorityImageLayer(layer) ? 'high' : undefined;
}

export function getImageSizesForLayer(layer: ImageLayerLike): string {
  if (isSmallBrandImageLayer(layer)) {
    return '(max-width: 809px) 80px, 96px';
  }
  if (isPriorityImageLayer(layer)) {
    return '100vw';
  }
  if (isFramedContentImageLayer(layer)) {
    return '(max-width: 809px) 100vw, (max-width: 1199px) 50vw, 24vw';
  }
  return '(max-width: 809px) 100vw, 50vw';
}

export function getImageSrcsetWidthsForLayer(layer: ImageLayerLike): number[] {
  if (isSmallBrandImageLayer(layer)) return BRAND_IMAGE_SRCSET_WIDTHS;
  if (isPriorityImageLayer(layer)) return PRIORITY_IMAGE_SRCSET_WIDTHS;
  return CONTENT_IMAGE_SRCSET_WIDTHS;
}

export function getFallbackImageWidthForLayer(layer: ImageLayerLike): number {
  if (isSmallBrandImageLayer(layer)) return 96;
  if (isPriorityImageLayer(layer)) return 1280;
  return isFramedContentImageLayer(layer) ? 480 : 768;
}

export function getImageTransformQualityForLayer(layer: ImageLayerLike): number {
  if (isPriorityImageLayer(layer)) return 72;
  if (isSmallBrandImageLayer(layer)) return 68;
  if (isFramedContentImageLayer(layer)) return 70;
  return 76;
}
