import type { Layer } from '@/types';

type ImageLayerLike = Pick<Layer, 'id' | 'name' | 'customName' | 'attributes'>;

const SMALL_IMAGE_SRCSET_WIDTHS = [96, 160, 240, 320];
const DEFAULT_IMAGE_SRCSET_WIDTHS = [320, 640, 960, 1280, 1920];

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

export function getImageLoadingAttribute(layer: ImageLayerLike): 'eager' | 'lazy' {
  return isPriorityImageLayer(layer) || isSmallBrandImageLayer(layer) ? 'eager' : 'lazy';
}

export function getImageFetchPriority(layer: ImageLayerLike): 'high' | 'auto' | undefined {
  return isPriorityImageLayer(layer) ? 'high' : undefined;
}

export function getImageSizesForLayer(layer: ImageLayerLike): string {
  if (isSmallBrandImageLayer(layer)) {
    return '(max-width: 809px) 96px, 160px';
  }
  return '100vw';
}

export function getImageSrcsetWidthsForLayer(layer: ImageLayerLike): number[] {
  return isSmallBrandImageLayer(layer) ? SMALL_IMAGE_SRCSET_WIDTHS : DEFAULT_IMAGE_SRCSET_WIDTHS;
}

export function getFallbackImageWidthForLayer(layer: ImageLayerLike): number {
  if (isSmallBrandImageLayer(layer)) return 160;
  return isPriorityImageLayer(layer) ? 1280 : 960;
}

export function getImageTransformQualityForLayer(layer: ImageLayerLike): number {
  if (isPriorityImageLayer(layer)) return 82;
  if (isSmallBrandImageLayer(layer)) return 80;
  return 80;
}
