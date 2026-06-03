import type { Layer } from '@/types';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveFormLayerId(layer: Pick<Layer, 'name' | 'settings' | 'attributes'>): string | null {
  const settings: Record<string, any> = isRecord(layer.settings) ? layer.settings : {};
  const attributes: Record<string, any> = isRecord(layer.attributes) ? layer.attributes : {};
  const studioImport = isRecord(settings.studioImport) ? settings.studioImport : {};

  const layerName = readString(layer.name).toLowerCase();
  const tag = readString(settings.tag || attributes.tag || attributes['data-tag']).toLowerCase();
  const hasFormSettings = isRecord(settings.form);
  const hasStudioImportSubmit = Boolean(
    attributes['data-studio-import-submit-mode']
      || attributes['data-studio-import-submit-endpoint']
      || attributes['data-studio-import-form']
  );

  // sourceFormId is metadata used to name a form after import. It is not a
  // reliable form signal by itself because wrapper layers can carry it too.
  const isFormLayer = layerName === 'form'
    || tag === 'form'
    || hasFormSettings
    || hasStudioImportSubmit;

  if (!isFormLayer) return null;

  return readString(settings.id)
    || readString(attributes.id)
    || readString(studioImport.sourceFormId)
    || readString(attributes['data-studio-import-form'])
    || 'unnamed-form';
}
