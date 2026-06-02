'use client';

import { useEffect } from 'react';
import type { Breakpoint } from '@/types';

export interface StudioRevealTarget {
  layerId: string;
  durationMs?: number;
  delayMs?: number;
  y?: number;
  breakpoints?: Breakpoint[];
}

function getCurrentBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

function shouldRunOnCurrentBreakpoint(target: StudioRevealTarget): boolean {
  if (!target.breakpoints || target.breakpoints.length === 0) return true;
  return target.breakpoints.includes(getCurrentBreakpoint());
}

function revealElement(element: HTMLElement, target: StudioRevealTarget) {
  element.removeAttribute('data-gsap-hidden');
  element.style.visibility = 'visible';

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduce || typeof element.animate !== 'function') {
    element.style.opacity = '1';
    element.style.transform = '';
    return;
  }

  const duration = Math.max(0, target.durationMs ?? 700);
  const delay = Math.max(0, target.delayMs ?? 0);
  const y = Number.isFinite(target.y) ? target.y || 0 : 24;
  const animation = element.animate(
    [
      { opacity: 0, transform: `translateY(${y}px)`, visibility: 'visible' },
      { opacity: 1, transform: 'translateY(0)', visibility: 'visible' },
    ],
    {
      duration,
      delay,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both',
    },
  );

  animation.finished.then(() => {
    element.style.opacity = '1';
    element.style.transform = '';
    element.style.visibility = 'visible';
  }).catch(() => undefined);
}

export default function StudioRevealInitializer({ targets }: { targets: StudioRevealTarget[] }) {
  useEffect(() => {
    if (targets.length === 0) return undefined;

    const pending = targets
      .filter(shouldRunOnCurrentBreakpoint)
      .map((target) => {
        const element = document.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(target.layerId)}"]`);
        return element ? { target, element } : null;
      })
      .filter((entry): entry is { target: StudioRevealTarget; element: HTMLElement } => Boolean(entry));

    if (pending.length === 0) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      pending.forEach(({ element, target }) => revealElement(element, target));
      return undefined;
    }

    const byElement = new Map<HTMLElement, StudioRevealTarget>();
    pending.forEach(({ element, target }) => byElement.set(element, target));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const element = entry.target as HTMLElement;
          const target = byElement.get(element);
          if (!target) return;
          observer.unobserve(element);
          byElement.delete(element);
          revealElement(element, target);
        });
      },
      { rootMargin: '0px 0px -15% 0px', threshold: 0.05 },
    );

    byElement.forEach((_, element) => observer.observe(element));

    return () => observer.disconnect();
  }, [targets]);

  return null;
}
