import type { Breakpoint, Layer, LayerInteraction } from '@/types';

export interface PublishedRevealTarget {
  layerId: string;
  durationMs?: number;
  delayMs?: number;
  x?: number | string;
  y?: number | string;
  breakpoints?: Breakpoint[];
}

export interface PublishedAnimationRuntime {
  revealTargets: PublishedRevealTarget[];
  requiresGsap: boolean;
}

/**
 * Split published interactions between the lightweight importer reveal
 * runtime and the full GSAP runtime. Studio-authored interactions always use
 * GSAP; only importer-marked, one-shot reveal interactions take the lean path.
 */
export function collectPublishedAnimationRuntime(layers: Layer[]): PublishedAnimationRuntime {
  const revealTargets: PublishedRevealTarget[] = [];
  let requiresGsap = false;

  const motionOffset = (value: unknown): number | string | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (/^-?(?:\d+|\d*\.\d+)(?:px|rem|em|vh|vw|%)?$/.test(trimmed)) {
      return /^-?(?:\d+|\d*\.\d+)$/.test(trimmed) ? Number(trimmed) : trimmed;
    }
    if (/^(?:calc|clamp|min|max)\(/.test(trimmed)) return trimmed;
    return undefined;
  };

  const isStudioRuntimeHandledInteraction = (layer: Layer): boolean => (
    layer.attributes?.['data-studio-mobile-drawer-trigger'] !== undefined
    || layer.attributes?.['data-studio-import-interaction'] === 'mobile-drawer'
  );

  const scanInteraction = (layer: Layer, interaction: LayerInteraction) => {
    if (isStudioRuntimeHandledInteraction(layer)) return;

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
        && (
          tween.apply_styles?.y === 'on-load'
          || tween.apply_styles?.x === 'on-load'
        )
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
        x: motionOffset(tween.from?.x),
        y: motionOffset(tween.from?.y),
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
