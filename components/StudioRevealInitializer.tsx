import type { Breakpoint } from '@/types';

export interface StudioRevealTarget {
  layerId: string;
  durationMs?: number;
  delayMs?: number;
  x?: number | string;
  y?: number | string;
  breakpoints?: Breakpoint[];
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export default function StudioRevealInitializer({ targets }: { targets: StudioRevealTarget[] }) {
  if (targets.length === 0) return null;

  return (
    <script
      id="studio-reveal-initializer"
      dangerouslySetInnerHTML={{
        __html: `
(() => {
  const targets = ${safeScriptJson(targets)};
  const currentBreakpoint = () => {
    if (window.innerWidth < 768) return 'mobile';
    if (window.innerWidth < 1024) return 'tablet';
    return 'desktop';
  };
  const shouldRun = (target) => (
    !Array.isArray(target.breakpoints)
    || target.breakpoints.length === 0
    || target.breakpoints.includes(currentBreakpoint())
  );
  const cssDistance = (value, fallback) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value + 'px';
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback;
  };
  const setVisible = (element) => {
    element.removeAttribute('data-gsap-hidden');
    element.style.opacity = '1';
    element.style.visibility = 'visible';
    element.style.transform = 'translate(0, 0)';
  };
  const reveal = (element, target) => {
    const hasX = target.x !== undefined && target.x !== null && String(target.x).trim() !== '';
    const x = cssDistance(target.x, '0px');
    const y = cssDistance(target.y, hasX ? '0px' : '24px');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    element.removeAttribute('data-gsap-hidden');
    if (reduce || typeof element.animate !== 'function') {
      setVisible(element);
      return;
    }

    const animation = element.animate(
      [
        { opacity: 0, transform: 'translate(' + x + ', ' + y + ')', visibility: 'visible' },
        { opacity: 1, transform: 'translate(0, 0)', visibility: 'visible' },
      ],
      {
        duration: Math.max(0, Number(target.durationMs) || 700),
        delay: Math.max(0, Number(target.delayMs) || 0),
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'both',
      },
    );
    animation.finished.then(() => setVisible(element)).catch(() => setVisible(element));
  };

  const pending = targets
    .filter(shouldRun)
    .map((target) => {
      const element = document.querySelector('[data-layer-id="' + CSS.escape(target.layerId) + '"]');
      return element instanceof HTMLElement ? { target, element } : null;
    })
    .filter(Boolean);

  if (pending.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    pending.forEach(({ element, target }) => reveal(element, target));
    return;
  }

  const byElement = new Map(pending.map(({ element, target }) => [element, target]));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const element = entry.target;
      const target = byElement.get(element);
      if (!target) return;
      observer.unobserve(element);
      byElement.delete(element);
      reveal(element, target);
    });
  }, { rootMargin: '0px 0px -15% 0px', threshold: 0.05 });

  byElement.forEach((_, element) => observer.observe(element));
})();
        `,
      }}
    />
  );
}
