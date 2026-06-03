'use client';

import { useEffect } from 'react';

type RuntimeCleanup = (() => void) | undefined;

function requestDeferredRuntime(callback: () => void): () => void {
  let finished = false;
  const run = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('pointerdown', run);
    window.removeEventListener('keydown', run);
    callback();
  };

  window.addEventListener('pointerdown', run, { once: true, passive: true });
  window.addEventListener('keydown', run, { once: true });

  if ('requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(run, { timeout: 1200 });
    return () => {
      finished = true;
      window.cancelIdleCallback(idleId);
      window.removeEventListener('pointerdown', run);
      window.removeEventListener('keydown', run);
    };
  }

  const timeoutId = globalThis.setTimeout(run, 800);
  return () => {
    finished = true;
    globalThis.clearTimeout(timeoutId);
    window.removeEventListener('pointerdown', run);
    window.removeEventListener('keydown', run);
  };
}

export default function DeferredStudioRuntimeInitializer() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: RuntimeCleanup;

    const cancelDeferredRuntime = requestDeferredRuntime(() => {
      import('@/components/StudioRuntimeInitializer')
        .then(({ initializeStudioRuntime }) => {
          if (cancelled) return;
          cleanup = initializeStudioRuntime();
        })
        .catch(() => undefined);
    });

    return () => {
      cancelled = true;
      cancelDeferredRuntime();
      cleanup?.();
    };
  }, []);

  return null;
}
