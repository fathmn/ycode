import AnimationInitializer from '@/components/AnimationInitializer';
import { extractAnimationLayers } from '@/lib/animation-utils';
import { collectPublishedAnimationRuntime } from '@/lib/published-animation-runtime';
import type { Layer } from '@/types';

export const PUBLISHED_GSAP_RUNTIME_MARKER_ID = 'ycode-published-gsap-runtime';

interface PublishedGsapInitializerProps {
  layers: Layer[];
  requiresGsap?: boolean;
}

/**
 * Published-only GSAP boundary. The parent can pass its already-computed gate;
 * tests and standalone callers may omit it and classify the layer tree here.
 */
export default function PublishedGsapInitializer({
  layers,
  requiresGsap = collectPublishedAnimationRuntime(layers).requiresGsap,
}: PublishedGsapInitializerProps) {
  if (!requiresGsap) return null;

  return (
    <>
      <script
        id={PUBLISHED_GSAP_RUNTIME_MARKER_ID}
        type="application/json"
        dangerouslySetInnerHTML={{ __html: '{}' }}
      />
      <AnimationInitializer layers={extractAnimationLayers(layers)} />
    </>
  );
}
