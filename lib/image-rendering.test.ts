import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFallbackImageWidthForLayer,
  getImageSizesForLayer,
  getImageSrcsetWidthsForLayer,
  getImageTransformQualityForLayer,
} from '@/lib/image-rendering';

type TestLayer = Parameters<typeof getImageSizesForLayer>[0];

function imageLayer(overrides: Partial<TestLayer> = {}): TestLayer {
  return {
    id: 'image',
    name: 'Image',
    customName: '',
    attributes: {},
    classes: [],
    ...overrides,
  };
}

const brand = imageLayer({ attributes: { 'data-studio-brand-logo': 'true' } });
const priority = imageLayer({ attributes: { 'data-studio-import-asset-id': 'hero' } });
const framed = imageLayer({ customName: 'feature-tab-image' });
const content = imageLayer();

test('image srcset ladders include Retina-width candidates for every image class', () => {
  assert.deepEqual(getImageSrcsetWidthsForLayer(brand), [92, 112, 184, 224, 336]);
  assert.deepEqual(getImageSrcsetWidthsForLayer(priority), [640, 960, 1280, 1600, 1920, 2560, 3840]);
  assert.deepEqual(getImageSrcsetWidthsForLayer(content), [320, 480, 640, 960, 1280, 1600, 1920, 2560]);
});

test('framed content uses a conservative sizes estimate of at least 50vw on desktop', () => {
  assert.equal(getImageSizesForLayer(framed), '(max-width: 809px) 100vw, 50vw');
});

test('image transform qualities preserve visible detail', () => {
  assert.equal(getImageTransformQualityForLayer(priority), 78);
  assert.equal(getImageTransformQualityForLayer(brand), 82);
  assert.equal(getImageTransformQualityForLayer(framed), 80);
  assert.equal(getImageTransformQualityForLayer(content), 80);
});

test('fallback widths are large enough when srcset is unavailable', () => {
  assert.equal(getFallbackImageWidthForLayer(brand), 224);
  assert.equal(getFallbackImageWidthForLayer(priority), 1920);
  assert.equal(getFallbackImageWidthForLayer(framed), 960);
  assert.equal(getFallbackImageWidthForLayer(content), 960);
});
