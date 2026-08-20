import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImageSrcset, getOptimizedImageUrl } from '@/lib/asset-utils';

const PUBLIC_IMAGE_URL =
  'https://project.supabase.co/storage/v1/object/public/assets/hero.jpg?cache=1&resize=cover';

test('getOptimizedImageUrl routes public Supabase images through the contain renderer', () => {
  const optimized = new URL(getOptimizedImageUrl(PUBLIC_IMAGE_URL, 640, 80));

  assert.equal(optimized.pathname, '/storage/v1/render/image/public/assets/hero.jpg');
  assert.equal(optimized.searchParams.get('width'), '640');
  assert.equal(optimized.searchParams.get('quality'), '80');
  assert.equal(optimized.searchParams.get('resize'), 'contain');
  assert.equal(optimized.searchParams.get('cache'), '1');
});

test('generateImageSrcset uses the Supabase renderer and contain mode', () => {
  const srcset = generateImageSrcset(PUBLIC_IMAGE_URL, [640, 1280], 85);
  const entries = srcset.split(', ');

  assert.equal(entries.length, 2);
  for (const [index, entry] of entries.entries()) {
    const [url, descriptor] = entry.split(' ');
    const transformed = new URL(url);
    const expectedWidth = index === 0 ? 640 : 1280;

    assert.equal(transformed.pathname, '/storage/v1/render/image/public/assets/hero.jpg');
    assert.equal(transformed.searchParams.get('width'), expectedWidth.toString());
    assert.equal(transformed.searchParams.get('quality'), '85');
    assert.equal(transformed.searchParams.get('resize'), 'contain');
    assert.equal(descriptor, `${expectedWidth}w`);
  }
});

test('generateImageSrcset caps the extended ladder at the source width', () => {
  const srcset = generateImageSrcset(PUBLIC_IMAGE_URL, undefined, 85, 2400);

  assert.match(srcset, /width=2400[^ ]* 2400w$/);
  assert.doesNotMatch(srcset, /width=(?:2560|3840)/);
});

test('generateImageSrcset includes 2560w and 3840w when the source width is unknown', () => {
  const srcset = generateImageSrcset(PUBLIC_IMAGE_URL);

  assert.match(srcset, /width=2560[^ ]* 2560w/);
  assert.match(srcset, /width=3840[^ ]* 3840w$/);
});

test('proxy image transformations remain on the Sharp route', () => {
  const proxyUrl = '/a/hash/hero.jpg?width=1920&quality=80';

  assert.equal(getOptimizedImageUrl(proxyUrl, 640, 75), '/a/hash/hero.jpg?width=640&quality=75');
  assert.equal(
    generateImageSrcset(proxyUrl, [320, 640], 75),
    '/a/hash/hero.jpg?width=320&quality=75 320w, /a/hash/hero.jpg?width=640&quality=75 640w'
  );
});

test('SVG and GIF URLs remain untransformed', () => {
  for (const extension of ['svg', 'gif']) {
    const url = `https://project.supabase.co/storage/v1/object/public/assets/image.${extension}`;

    assert.equal(getOptimizedImageUrl(url, 640, 80), url);
    assert.equal(generateImageSrcset(url), '');
  }
});
