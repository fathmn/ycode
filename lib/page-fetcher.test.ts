import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layerToHtml } from '@/lib/page-fetcher';
import type { Layer } from '@/types';

function renderVideo(attributes: Layer['attributes']): string {
  const layer: Layer = {
    id: 'published-video',
    name: 'video',
    classes: '',
    attributes,
    variables: {
      video: {
        src: {
          type: 'dynamic_text',
          data: { content: '/hero.mp4' },
        },
      },
    },
  };

  return layerToHtml(layer);
}

function countAttribute(html: string, attribute: string): number {
  const openingTag = html.match(/^<video\b[^>]*>/i)?.[0] || '';
  return Array.from(openingTag.matchAll(new RegExp(`\\s${attribute}(?=\\s|=|>)`, 'gi'))).length;
}

test('published HTML autoplay video overrides metadata preload exactly once', () => {
  const html = renderVideo({
    autoplay: true,
    muted: true,
    loop: true,
    preload: 'metadata',
  });

  assert.equal(countAttribute(html, 'preload'), 1);
  assert.match(html, /\spreload="auto"(?=\s|>)/i);
  assert.match(html, /\splaysinline(?=\s|>)/i);
  assert.match(html, /\sautoplay(?=\s|>)/i);
  assert.match(html, /\smuted(?=\s|>)/i);
});

test('published HTML autoplay video accepts serialized boolean values', () => {
  for (const autoplay of ['', 'true']) {
    const html = renderVideo({
      autoplay,
      preload: 'metadata',
    } as unknown as Layer['attributes']);

    assert.equal(countAttribute(html, 'preload'), 1);
    assert.match(html, /\spreload="auto"(?=\s|>)/i);
    assert.match(html, /\sautoplay(?=\s|>)/i);
    assert.match(html, /\smuted(?=\s|>)/i);
  }
});

test('published HTML non-autoplay video preserves its preload attribute', () => {
  const html = renderVideo({
    autoplay: false,
    muted: false,
    loop: true,
    preload: 'metadata',
  });

  assert.equal(countAttribute(html, 'preload'), 1);
  assert.match(html, /\spreload="metadata"(?=\s|>)/i);
  assert.match(html, /\splaysinline(?=\s|>)/i);
  assert.doesNotMatch(html, /\sautoplay(?=\s|>)/i);
  assert.doesNotMatch(html, /\smuted(?=\s|>)/i);
});
