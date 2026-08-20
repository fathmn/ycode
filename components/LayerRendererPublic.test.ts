import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { Layer } from '@/types';
import { FORM_RESET_CSS } from '@/components/form-reset-css';
import LayerRendererPublic from '@/components/LayerRendererPublic';

function renderVideo(attributes: Layer['attributes']): string {
  const layer: Layer = {
    id: 'hero-video',
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

  return renderToString(
    React.createElement(LayerRendererPublic, {
      layers: [layer],
      isPublished: true,
    }),
  );
}

test('published autoplay video declares playback attributes in SSR markup', () => {
  // HTML attribute names are ASCII case-insensitive. React 19 emits the JSX
  // spellings `autoPlay` and `playsInline`, which browsers parse as the native
  // `autoplay` and `playsinline` attributes.
  const html = renderVideo({ autoplay: true, muted: true, loop: true });
  const normalizedHtml = html.toLowerCase();

  assert.match(normalizedHtml, /^<video\b/);
  assert.match(normalizedHtml, /\bautoplay=""/);
  assert.match(normalizedHtml, /\bmuted=""/);
  assert.match(normalizedHtml, /\bplaysinline=""/);
  assert.match(normalizedHtml, /\bpreload="auto"/);
  assert.match(normalizedHtml, /\bsrc="\/hero\.mp4"/);
});

test('published autoplay video accepts serialized boolean attribute values', () => {
  for (const autoplay of ['', 'true']) {
    const html = renderVideo({ autoplay } as unknown as Layer['attributes']).toLowerCase();

    assert.match(html, /\bautoplay=""/);
    assert.match(html, /\bplaysinline=""/);
    assert.match(html, /\bpreload="auto"/);
  }
});

test('published non-autoplay video keeps the browser preload default', () => {
  const html = renderVideo({ autoplay: false, muted: false });

  assert.doesNotMatch(html.toLowerCase(), /\bpreload=/);
});

test('form reset keeps unsized checkbox and radio controls visible', () => {
  assert.match(FORM_RESET_CSS, /@layer base\{/);
  assert.match(
    FORM_RESET_CSS,
    /:where\(input\[type="checkbox"\],input\[type="radio"\]\)\{width:18px;height:18px;flex:none;border:1px solid #a3a3a3;background:#fff;cursor:pointer;display:inline-block;vertical-align:middle\}/,
  );
  assert.match(FORM_RESET_CSS, /:where\(input\[type="checkbox"\]\)\{border-radius:4px\}/);
  assert.match(FORM_RESET_CSS, /:where\(input\[type="radio"\]\)\{border-radius:50%\}/);
  assert.match(
    FORM_RESET_CSS,
    /:focus-visible\{outline:2px solid currentColor;outline-offset:2px\}/,
  );
  assert.match(
    FORM_RESET_CSS,
    /input\[type="checkbox"\]:checked,input\[type="radio"\]:checked\{background-color:currentColor;/,
  );
});
