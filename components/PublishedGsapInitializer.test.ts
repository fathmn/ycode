import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import PublishedGsapInitializer, {
  PUBLISHED_GSAP_RUNTIME_MARKER_ID,
} from '@/components/PublishedGsapInitializer';
import type { Layer, LayerInteraction } from '@/types';

function createAnimatedLayer(): Layer {
  return {
    id: 'heading',
    name: 'heading',
    classes: 'text-4xl',
    interactions: [{
      id: 'fade-in-up',
      trigger: 'scroll-into-view',
      timeline: {
        breakpoints: ['desktop', 'tablet', 'mobile'],
        repeat: 0,
        yoyo: false,
        toggleActions: 'play none none none',
      },
      tweens: [{
        id: 'fade-in-up-tween',
        layer_id: 'heading',
        position: 0,
        duration: 0.7,
        ease: 'power2.out',
        from: { y: '24', autoAlpha: '0' },
        to: { y: '0', autoAlpha: '100' },
        apply_styles: { y: 'on-load', autoAlpha: 'on-load' },
      }],
    }],
  };
}

test('published Studio animation renders the gated GSAP runtime marker', () => {
  const html = renderToString(
    React.createElement(PublishedGsapInitializer, { layers: [createAnimatedLayer()] }),
  );

  assert.match(html, new RegExp(`id="${PUBLISHED_GSAP_RUNTIME_MARKER_ID}"`));
});

test('published page without interactions omits the GSAP runtime marker', () => {
  const layer: Layer = { id: 'heading', name: 'heading', classes: 'text-4xl' };
  const html = renderToString(
    React.createElement(PublishedGsapInitializer, { layers: [layer] }),
  );

  assert.equal(html, '');
});

test('simple importer reveal keeps the lightweight runtime gate', () => {
  const layer = createAnimatedLayer();
  const interaction = layer.interactions?.[0] as LayerInteraction & { studioImportReveal?: boolean };
  interaction.studioImportReveal = true;

  const html = renderToString(
    React.createElement(PublishedGsapInitializer, { layers: [layer] }),
  );

  assert.equal(html, '');
});
