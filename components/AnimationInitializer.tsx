'use client';

/**
 * AnimationInitializer - Initializes GSAP animations based on layer interactions
 * Runs on the client to set up all animations for preview/published pages.
 *
 * Initial styles for 'on-load' mode are applied server-side via generateInitialAnimationCSS()
 * to prevent flickering. This component only handles animation triggers.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

import { buildGsapProps, addTweenToTimeline, createSplitTextAnimation, generateInitialAnimationCSS } from '@/lib/animation-utils';
import { getCurrentBreakpoint } from '@/lib/breakpoint-utils';
import { studioFetch } from '@/lib/api';
import type { Layer, LayerInteraction, Breakpoint } from '@/types';

const mobileDrawerBodyLocks = new Set<HTMLElement>();
let mobileDrawerPreviousBodyOverflow: string | null = null;
const mobileDrawerTriggerTimelineControls = new WeakMap<HTMLElement, { reverse: () => void }>();

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText);
}

interface AnimationInitializerProps {
  layers: Layer[];
  injectInitialCSS?: boolean;
  initializeGlobalRuntime?: boolean;
}

interface CollectedInteraction {
  triggerLayerId: string;
  interaction: LayerInteraction;
}

function isStudioHostForPreview(hostname: string): boolean {
  return hostname === 'studio.novum-partners.de'
    || hostname === 'localhost'
    || hostname === '127.0.0.1';
}

function getStudioPreviewReportContext(location: Location, previewLocationKey: string): {
  previewUrl: string;
  previewProjectParam: string | null;
} | null {
  const previewUrl = previewLocationKey || `${location.pathname}${location.search}`;
  const previewUrlObject = new URL(previewUrl, location.origin);
  const currentPathname = previewUrlObject.pathname;

  if (currentPathname === '/ycode/preview' || currentPathname.startsWith('/ycode/preview/')) {
    return {
      previewUrl: `${previewUrlObject.pathname}${previewUrlObject.search}`,
      previewProjectParam: previewUrlObject.searchParams.get('project'),
    };
  }

  if (!isStudioHostForPreview(location.hostname)) return null;

  const segments = currentPathname.split('/').filter(Boolean);
  if (segments.length < 2 || segments[1] !== 'preview') return null;

  const canonicalUrl = new URL(`/ycode/${segments.slice(1).join('/')}`, location.origin);
  previewUrlObject.searchParams.forEach((value, key) => {
    canonicalUrl.searchParams.set(key, value);
  });
  if (segments[0]) {
    canonicalUrl.searchParams.set('project', segments[0]);
  }

  return {
    previewUrl: `${canonicalUrl.pathname}${canonicalUrl.search}`,
    previewProjectParam: canonicalUrl.searchParams.get('project'),
  };
}

/** Recursively collect all interactions from layers */
function collectInteractions(layers: Layer[]): CollectedInteraction[] {
  const interactions: CollectedInteraction[] = [];

  const traverse = (layerList: Layer[]) => {
    layerList.forEach((layer) => {
      if (layer.interactions?.length) {
        layer.interactions.forEach((interaction) => {
          interactions.push({ triggerLayerId: layer.id, interaction });
        });
      }
      if (layer.children) {
        traverse(layer.children);
      }
    });
  };

  traverse(layers);
  return interactions;
}

/** Check if interaction should run on specified breakpoint */
function shouldRunOnBreakpoint(interaction: LayerInteraction, breakpoint: Breakpoint): boolean {
  if (!interaction.timeline?.breakpoints) return true;
  return interaction.timeline.breakpoints.includes(breakpoint);
}

/** Get element by layer ID */
function getElement(layerId: string): HTMLElement | null {
  return document.querySelector(`[data-layer-id="${layerId}"]`);
}

function formatCounterValue(value: number, prefix: string, suffix: string): string {
  return `${prefix}${Math.round(value).toLocaleString('de-DE')}${suffix}`;
}

// Studio Mobile Drawer initializer.
//
// Imported headers from the Studio importer carry [data-studio-mobile-drawer]
// (the drawer panel) and [data-studio-mobile-drawer-trigger] (the burger
// button). Ycode interactions can already toggle a CSS class via the click
// trigger, but the source UX adds:
//  - body scroll lock while the drawer is open
//  - Escape key closes the drawer and returns focus to the trigger
//  - focus-trap so Tab cycles inside the open drawer
//  - aria-expanded / aria-hidden / aria-controls sync
//
// We attach all four behaviours generically so any Studio-imported HR-style
// drawer benefits without per-project runtime code.
function initializeStudioMobileDrawer(): Array<() => void> {
  const drawers = Array.from(
    document.querySelectorAll<HTMLElement>('[data-studio-mobile-drawer]'),
  );
  if (drawers.length === 0) return [];

  const cleanups: Array<() => void> = [];
  const OPEN_CLASS = 'studio-mobile-drawer--open';
  const CLOSING_CLASS = 'studio-mobile-drawer--closing';
  const CLOSE_DURATION_MS = 600;

  for (const drawer of drawers) {
    const drawerId = drawer.id || drawer.getAttribute('data-studio-mobile-drawer-id') || '';
    const triggerCandidates = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-mobile-drawer-trigger]'));
    const trigger = drawerId
      ? triggerCandidates.find((candidate) =>
        candidate.getAttribute('data-studio-mobile-drawer-target') === drawerId
        || candidate.getAttribute('aria-controls') === drawerId
      ) || null
      : triggerCandidates[0] || null;

    drawer.setAttribute('role', drawer.getAttribute('role') || 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-hidden', 'true');
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (drawerId && !trigger.getAttribute('aria-controls')) {
        trigger.setAttribute('aria-controls', drawerId);
      }
    }

    const isOpen = () => drawer.classList.contains(OPEN_CLASS);
    const isClosing = () => drawer.classList.contains(CLOSING_CLASS);
    let closeTimeoutId: number | null = null;
    let visualRafId: number | null = null;
    let focusRafId: number | null = null;

    const clearCloseTimer = () => {
      if (closeTimeoutId !== null) {
        window.clearTimeout(closeTimeoutId);
        closeTimeoutId = null;
      }
    };

    const clearPendingFrames = () => {
      if (visualRafId !== null) {
        window.cancelAnimationFrame(visualRafId);
        visualRafId = null;
      }
      if (focusRafId !== null) {
        window.cancelAnimationFrame(focusRafId);
        focusRafId = null;
      }
    };

    const lockBodyScroll = () => {
      if (mobileDrawerBodyLocks.size === 0) {
        mobileDrawerPreviousBodyOverflow = document.body.style.overflow;
      }
      mobileDrawerBodyLocks.add(drawer);
      document.body.style.overflow = 'hidden';
    };

    const unlockBodyScroll = () => {
      mobileDrawerBodyLocks.delete(drawer);
      if (mobileDrawerBodyLocks.size === 0) {
        document.body.style.overflow = mobileDrawerPreviousBodyOverflow || '';
        mobileDrawerPreviousBodyOverflow = null;
      }
    };

    const applyClosedDrawerVisualState = () => {
      drawer.style.visibility = 'hidden';
      drawer.style.opacity = '0';
      drawer.style.transform = 'translateY(-12px)';
      drawer.style.pointerEvents = 'none';
    };

    const focusFirst = () => {
      const focusables = drawer.querySelectorAll<HTMLElement>(
        'a[href]:not([tabindex="-1"]):not([aria-hidden="true"]), button:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"]), [tabindex]:not([tabindex="-1"]):not([aria-hidden="true"])',
      );
      const visible = Array.from(focusables).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
      );
      visible[0]?.focus();
    };

    const open = () => {
      clearCloseTimer();
      clearPendingFrames();
      if (isOpen() && !isClosing()) return;
      drawer.classList.remove(CLOSING_CLASS);
      drawer.classList.add(OPEN_CLASS);
      drawer.setAttribute('aria-hidden', 'false');
      trigger?.setAttribute('aria-expanded', 'true');
      lockBodyScroll();
      window.dispatchEvent(new CustomEvent('studio:mobile-drawer-state-change'));
      visualRafId = requestAnimationFrame(() => {
        visualRafId = null;
        drawer.style.visibility = 'visible';
        drawer.style.opacity = '1';
        drawer.style.transform = 'translateY(0px)';
        drawer.style.pointerEvents = '';
      });
      focusRafId = requestAnimationFrame(() => {
        focusRafId = null;
        focusFirst();
      });
    };

    const finishClose = (returnFocus: boolean) => {
      closeTimeoutId = null;
      drawer.classList.remove(OPEN_CLASS);
      drawer.classList.remove(CLOSING_CLASS);
      drawer.setAttribute('aria-hidden', 'true');
      applyClosedDrawerVisualState();
      window.dispatchEvent(new CustomEvent('studio:mobile-drawer-state-change'));
      if (returnFocus) {
        requestAnimationFrame(() => trigger?.focus());
      }
    };

    const close = (returnFocus = true, deferVisualState = false) => {
      if (!isOpen()) return;
      trigger?.setAttribute('aria-expanded', 'false');
      unlockBodyScroll();
      clearCloseTimer();
      clearPendingFrames();

      if (deferVisualState) {
        drawer.classList.remove(OPEN_CLASS);
        drawer.classList.add(CLOSING_CLASS);
        drawer.style.pointerEvents = 'none';
        window.dispatchEvent(new CustomEvent('studio:mobile-drawer-state-change'));
        visualRafId = requestAnimationFrame(() => {
          visualRafId = null;
          drawer.style.visibility = 'visible';
          drawer.style.opacity = '0';
          drawer.style.transform = 'translateY(-12px)';
        });
        closeTimeoutId = window.setTimeout(() => finishClose(returnFocus), CLOSE_DURATION_MS);
        return;
      }

      finishClose(returnFocus);
    };

    // The Studio importer registers a GSAP yoyo-click interaction on the same
    // trigger button that animates opacity/translate. Our runtime listens for
    // the same click event and only manages ARIA, body-scroll-lock, focus and
    // the .studio-mobile-drawer--open class. We do NOT call preventDefault so
    // the GSAP click handler still toggles its timeline.
    //
    // `synthesizingRef` guards re-entrance: when the runtime issues a synthetic
    // click on the trigger to keep GSAP in sync after Esc/link/backdrop close,
    // onTriggerClick must skip its own state toggle so it doesn't immediately
    // reopen the drawer. Without this guard, ARIA/scroll-lock/focus-trap state
    // and the GSAP timeline drift apart after the first non-burger close.
    const synthesizingRef = { current: false };
    const onTriggerClick = () => {
      if (synthesizingRef.current) return;
      if (isClosing()) {
        open();
      } else if (isOpen()) {
        close(false, true);
      } else {
        open();
      }
    };

    // Closes triggered from inside the drawer reverse only the importer's
    // drawer timeline. Avoid dispatching a synthetic DOM click on the burger:
    // that would also fire analytics, custom handlers, or future navigation.
    const closeAndSync = (returnFocus = true) => {
      close(returnFocus, true);
      if (trigger) mobileDrawerTriggerTimelineControls.get(trigger)?.reverse();
    };

    const onCloseClick = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const closer = target.closest('[data-studio-mobile-drawer-close]');
      if (closer && drawer.contains(closer)) {
        e.preventDefault();
        closeAndSync();
      }
    };

    const onLinkClick = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (link && drawer.contains(link)) {
        const anchor = link as HTMLAnchorElement;
        if (
          e instanceof MouseEvent
          && !e.metaKey
          && !e.ctrlKey
          && !e.shiftKey
          && !e.altKey
          && !anchor.target
          && !anchor.hasAttribute('download')
        ) {
          closeAndSync(false);
          return;
        }

        closeAndSync(false);
      }
    };

    // Tap on the drawer backdrop (the dark surface itself, not a nav child)
    // closes the drawer to match common mobile-drawer UX patterns.
    const onBackdropClick = (e: Event) => {
      if (!isOpen()) return;
      if (e.target === drawer) {
        e.preventDefault();
        closeAndSync();
      }
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAndSync();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = drawer.querySelectorAll<HTMLElement>(
        'a[href]:not([tabindex="-1"]):not([aria-hidden="true"]), button:not([disabled]):not([tabindex="-1"]):not([aria-hidden="true"]), [tabindex]:not([tabindex="-1"]):not([aria-hidden="true"])',
      );
      const visible = Array.from(focusables).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
      );
      if (visible.length === 0) return;
      const first = visible[0];
      const last = visible[visible.length - 1];
      const active = document.activeElement;
      const insideDrawer = active instanceof Node && drawer.contains(active);
      if (!insideDrawer) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    trigger?.addEventListener('click', onTriggerClick);
    drawer.addEventListener('click', onCloseClick);
    drawer.addEventListener('click', onLinkClick);
    drawer.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeydown);

    cleanups.push(() => {
      trigger?.removeEventListener('click', onTriggerClick);
      drawer.removeEventListener('click', onCloseClick);
      drawer.removeEventListener('click', onLinkClick);
      drawer.removeEventListener('click', onBackdropClick);
      document.removeEventListener('keydown', onKeydown);
      // Cleanup runs on breakpoint changes (currentBreakpoint is a useEffect
      // dependency), not just on unmount. Fully reset the runtime state so a
      // resize-while-open does not strand the .studio-mobile-drawer--open
      // class while ARIA is re-initialized as closed.
      clearCloseTimer();
      clearPendingFrames();
      if (isOpen() || isClosing()) {
        drawer.classList.remove(OPEN_CLASS);
        drawer.classList.remove(CLOSING_CLASS);
        drawer.setAttribute('aria-hidden', 'true');
        trigger?.setAttribute('aria-expanded', 'false');
        unlockBodyScroll();
        applyClosedDrawerVisualState();
        window.dispatchEvent(new CustomEvent('studio:mobile-drawer-state-change'));
      }
    });
  }

  return cleanups;
}

// Mirrors hr-interim-solutions-studio/components/page-transition.tsx: a
// generic 700ms opacity+translateY fade-up applied to the root content
// container on initial page load. Honors prefers-reduced-motion. Studio pages
// are server-rendered and reload between routes, so this runs once per page
// load. The importer marks the wrapper with [data-studio-page-transition];
// if no such marker is present, we do not animate. Earlier versions fell back
// to `#ybody > :first-child` and `document.body.firstElementChild`, which
// could animate unrelated Ycode chrome (login, setup wizard, error pages) and
// surprise users with a fade on every navigation. The strict marker rule
// keeps the effect scoped to Studio-imported pages only.
function initializeStudioPageTransition(): Array<() => void> {
  if (typeof document === 'undefined') return [];
  const target = document.querySelector<HTMLElement>('[data-studio-page-transition]');
  if (!target) return [];
  if (target.dataset.studioPageTransitionRan === '1') return [];

  const cleanups: Array<() => void> = [];
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const isMobile = window.matchMedia?.('(max-width: 767px)').matches ?? false;
  if (reduce || isMobile) {
    target.style.opacity = '';
    target.style.transform = '';
    target.style.willChange = '';
    target.dataset.studioPageTransitionRan = '1';
    return [];
  }

  if (typeof target.animate !== 'function') {
    target.style.opacity = '';
    target.style.transform = '';
    target.style.willChange = '';
    target.dataset.studioPageTransitionRan = '1';
    return [];
  }

  const cssAnimationName = window.getComputedStyle(target).animationName;
  if (cssAnimationName && cssAnimationName !== 'none') {
    target.dataset.studioPageTransitionRan = '1';
    const clearWillChange = () => {
      target.style.willChange = '';
    };
    target.addEventListener('animationend', clearWillChange, { once: true });
    cleanups.push(() => {
      target.removeEventListener('animationend', clearWillChange);
      clearWillChange();
    });
    return [];
  }

  const previousWillChange = target.style.willChange;
  target.style.willChange = 'transform';
  const animation = target.animate(
    [
      { transform: 'translateY(12px)' },
      { transform: 'translateY(0)' },
    ],
    { duration: 360, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
  );
  target.dataset.studioPageTransitionRan = '1';
  animation.finished.then(() => {
    target.style.willChange = previousWillChange;
  }).catch(() => undefined);

  cleanups.push(() => {
    animation.cancel();
    target.style.willChange = previousWillChange;
  });
  return cleanups;
}

function normalizePathname(value: string | null | undefined): string {
  if (!value) return '/';
  try {
    const url = new URL(value, window.location.origin);
    value = url.pathname;
  } catch {
    value = value.split('#')[0]?.split('?')[0] || '/';
  }
  const normalized = value.replace(/\/+$/, '');
  return normalized || '/';
}

function initializeStudioActiveNav(): Array<() => void> {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-studio-header-nav-link][href]'));
  if (links.length === 0) return [];

  const current = normalizePathname(window.location.pathname);
  links.forEach((link) => {
    const href = normalizePathname(link.getAttribute('href'));
    if (href === current) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  return [];
}

function initializeStudioPreviewProjectLinks(): Array<() => void> {
  if (typeof window === 'undefined') return [];
  if (window.location.pathname !== '/ycode/preview' && !window.location.pathname.startsWith('/ycode/preview/')) return [];

  const project = new URL(window.location.href).searchParams.get('project');
  if (!project) return [];

  const applyProject = (root: ParentNode = document) => {
    const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="/ycode/preview"]'));
    links.forEach((link) => {
      const rawHref = link.getAttribute('href') || '';
      try {
        const target = new URL(rawHref, window.location.origin);
        if (target.pathname !== '/ycode/preview' && !target.pathname.startsWith('/ycode/preview/')) return;
        if (!target.searchParams.has('project')) {
          target.searchParams.set('project', project);
          link.setAttribute('href', `${target.pathname}${target.search}${target.hash}`);
        }
      } catch {
        // Ignore malformed hrefs; sanitization happens in the renderer.
      }
    });
  };

  applyProject();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const element = node as Element;
        if (element.matches('a[href^="/ycode/preview"]')) {
          applyProject(element.parentNode || document);
        } else {
          applyProject(element);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return [() => observer.disconnect()];
}

function initializeStudioFeatureTabs(): Array<() => void> {
  const tablists = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-feature-tabs-tablist]'));
  if (tablists.length === 0) return [];

  const cleanups: Array<() => void> = [];

  for (const tablist of tablists) {
    const container = tablist.closest<HTMLElement>('[data-studio-feature-tabs-section]')
      || tablist.parentElement;
    if (!container) continue;
    const panels = new Map<string, HTMLElement>();
    const tabs = Array.from(tablist.querySelectorAll<HTMLButtonElement>('[data-studio-feature-tab][data-studio-feature-tab-index]')).filter((tab) => {
      const panelId = tab.getAttribute('aria-controls');
      if (!panelId) return false;
      const panel = container.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`);
      if (panel instanceof HTMLElement && panel.matches('[data-studio-feature-panel]')) {
        panels.set(panelId, panel);
        return true;
      }
      return false;
    });
    if (tabs.length === 0 || panels.size === 0) continue;

    const setActive = (nextIndex: number, focus = false) => {
      const normalizedIndex = ((nextIndex % tabs.length) + tabs.length) % tabs.length;
      tabs.forEach((tab, index) => {
        const active = index === normalizedIndex;
        const activeBg = tab.dataset.studioFeatureTabActiveBg || '#080808';
        const activeColor = tab.dataset.studioFeatureTabActiveColor || '#ffffff';
        const inactiveBg = tab.dataset.studioFeatureTabInactiveBg || '#ffffff';
        const inactiveColor = tab.dataset.studioFeatureTabInactiveColor || '#1c1c1c';
        tab.dataset.studioFeatureTab = active ? 'active' : 'inactive';
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        tab.style.backgroundColor = active ? activeBg : inactiveBg;
        tab.style.color = active ? activeColor : inactiveColor;
        if (focus && active) tab.focus();
      });
      panels.forEach((panel) => {
        const activeTab = tabs[normalizedIndex];
        const active = Boolean(activeTab?.getAttribute('aria-controls') === panel.id);
        panel.dataset.studioFeaturePanel = active ? 'active' : 'inactive';
        panel.setAttribute('aria-hidden', active ? 'false' : 'true');
        panel.style.display = active
          ? panel.dataset.studioFeaturePanelActiveDisplay || ''
          : panel.dataset.studioFeaturePanelInactiveDisplay || 'none';
        panel.style.marginTop = active
          ? panel.dataset.studioFeaturePanelActiveMarginTop || ''
          : panel.dataset.studioFeaturePanelInactiveMarginTop || '';
        panel.style.borderTop = active
          ? panel.dataset.studioFeaturePanelActiveBorderTop || ''
          : panel.dataset.studioFeaturePanelInactiveBorderTop || '';
      });

      const activeTab = tabs[normalizedIndex];
      if (activeTab && tablist.scrollWidth > tablist.clientWidth) {
        const left = activeTab.offsetLeft - (tablist.clientWidth - activeTab.offsetWidth) / 2;
        tablist.scrollTo({ left, behavior: 'smooth' });
      }
    };

    const tabCleanups = tabs.map((tab, index) => {
      const onClick = () => setActive(index);
      tab.addEventListener('click', onClick);
      return () => tab.removeEventListener('click', onClick);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const current = Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
      setActive(event.key === 'ArrowRight' ? current + 1 : current - 1, true);
    };
    tablist.addEventListener('keydown', onKeyDown);
    const initialIndex = Math.max(0, tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));
    setActive(initialIndex);

    cleanups.push(() => {
      tabCleanups.forEach((cleanup) => cleanup());
      tablist.removeEventListener('keydown', onKeyDown);
    });
  }

  return cleanups;
}

function initializeStudioHeaderScroll(): Array<() => void> {
  const headers = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-site-header]'));
  if (headers.length === 0) return [];

  let rafId: number | null = null;
  const originalTransitions = new WeakMap<HTMLElement, string>();

  const update = () => {
    rafId = null;
    const drawerOpen = Boolean(document.querySelector(
      '[data-studio-mobile-drawer].studio-mobile-drawer--open, [data-studio-mobile-drawer][aria-hidden="false"]',
    ));
    for (const header of headers) {
      const ratio = Number(header.dataset.studioHeaderScrollRatio || '0.85');
      const threshold = window.innerHeight * (Number.isFinite(ratio) ? ratio : 0.85);
      const scrolled = window.scrollY > threshold;
      const onDark = drawerOpen || !scrolled;
      header.dataset.surface = onDark ? 'dark' : 'light';
      header.dataset.studioHeaderScrolled = scrolled ? 'true' : 'false';
      header.dataset.studioMobileDrawerOpen = drawerOpen ? 'true' : 'false';

      if (drawerOpen) {
        if (!originalTransitions.has(header)) {
          originalTransitions.set(header, header.style.transition || '');
        }
        header.style.transition = 'none';
        header.style.backgroundColor = 'transparent';
      } else if (originalTransitions.has(header)) {
        header.style.transition = originalTransitions.get(header) || '';
        header.style.backgroundColor = '';
        originalTransitions.delete(header);
      }

      const logo = header.querySelector<HTMLElement>('[data-studio-header-logo]');
      if (logo) {
        logo.dataset.studioBrandLogo = onDark ? 'dark' : 'light';
      }
    }
  };

  const restoreHeaderTransitions = () => {
    for (const header of headers) {
      if (!originalTransitions.has(header)) continue;
      header.style.transition = originalTransitions.get(header) || '';
      header.style.backgroundColor = '';
      originalTransitions.delete(header);
    }
  };

  const schedule = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('studio:mobile-drawer-state-change', schedule);

  return [() => {
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    restoreHeaderTransitions();
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('studio:mobile-drawer-state-change', schedule);
  }];
}

function initializeStudioCounters(): Array<() => void> {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-counter-value]'));
  if (elements.length === 0) return [];

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const cleanups: Array<() => void> = [];

  for (const element of elements) {
    const target = Number(element.dataset.studioCounterTo || '0');
    const prefix = element.dataset.studioCounterPrefix || '';
    const suffix = element.dataset.studioCounterSuffix || '';
    const duration = Number(element.dataset.studioCounterDuration || '1800');
    const delay = Number(element.dataset.studioCounterDelay || '0');

    if (!Number.isFinite(target)) continue;

    if (prefersReducedMotion) {
      element.textContent = formatCounterValue(target, prefix, suffix);
      continue;
    }

    element.textContent = formatCounterValue(0, prefix, suffix);

    let timeoutId: number | null = null;
    let rafId: number | null = null;
    let observer: IntersectionObserver | null = null;
    let started = false;

    const animate = () => {
      if (started) return;
      started = true;

      timeoutId = window.setTimeout(() => {
        const start = performance.now();
        const ease = (t: number) => 1 - Math.pow(1 - t, 3);
        const step = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          element.textContent = formatCounterValue(target * ease(progress), prefix, suffix);
          if (progress < 1) {
            rafId = window.requestAnimationFrame(step);
          } else {
            rafId = null;
            element.textContent = formatCounterValue(target, prefix, suffix);
          }
        };
        rafId = window.requestAnimationFrame(step);
      }, delay);
    };

    if (typeof IntersectionObserver === 'undefined') {
      animate();
      cleanups.push(() => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (rafId !== null) window.cancelAnimationFrame(rafId);
      });
      continue;
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          observer = null;
          animate();
        }
      },
      { rootMargin: '-15% 0px -15% 0px' },
    );
    const observerTarget = element.closest<HTMLElement>('[data-studio-counter-root], [data-studio-metrics-grid]') ?? element;
    observer.observe(observerTarget);

    cleanups.push(() => {
      observer?.disconnect();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    });
  }

  return cleanups;
}

/**
 * Collect info about elements that should start hidden based on interactions
 * Returns a map of layerId -> breakpoints (null means all breakpoints)
 */
function collectHiddenLayerInfo(interactions: CollectedInteraction[]): Map<string, string[] | null> {
  const hiddenMap = new Map<string, string[] | null>();

  interactions.forEach(({ interaction }) => {
    const breakpoints = interaction.timeline?.breakpoints || null;

    (interaction.tweens || []).forEach((tween) => {
      // Check if this tween has display: hidden with on-load apply style
      if (tween.from?.display === 'hidden' && tween.apply_styles?.display === 'on-load') {
        hiddenMap.set(tween.layer_id, breakpoints);
      }
    });
  });

  return hiddenMap;
}

/**
 * Reset GSAP inline styles and restore initial data attributes for a breakpoint
 */
function resetAnimationStates(
  interactions: CollectedInteraction[],
  hiddenLayerInfo: Map<string, string[] | null>,
  newBreakpoint: Breakpoint
): void {
  // Collect all layer IDs that are targeted by animations
  const animatedLayerIds = new Set<string>();
  interactions.forEach(({ interaction }) => {
    (interaction.tweens || []).forEach((tween) => {
      animatedLayerIds.add(tween.layer_id);
    });
  });

  // Reset each animated element
  animatedLayerIds.forEach((layerId) => {
    const element = getElement(layerId);
    if (!element) return;

    // Clear GSAP inline styles
    gsap.set(element, { clearProps: 'all' });

    // Reset data-gsap-hidden attribute based on new breakpoint
    const hiddenBreakpoints = hiddenLayerInfo.get(layerId);
    if (hiddenBreakpoints !== undefined) {
      // Check if element should be hidden for the new breakpoint
      const shouldBeHidden = hiddenBreakpoints === null || hiddenBreakpoints.includes(newBreakpoint);

      if (shouldBeHidden) {
        // Restore hidden state with breakpoint info
        element.setAttribute('data-gsap-hidden', hiddenBreakpoints?.join(' ') || '');
      } else {
        // Remove hidden state - not applicable to this breakpoint
        element.removeAttribute('data-gsap-hidden');
      }
    }
  });
}

/** Build a GSAP timeline from an interaction */
function buildTimeline(interaction: LayerInteraction): gsap.core.Timeline | null {
  const isYoyo = interaction.timeline?.yoyo ?? false;

  // Track elements with display transitions for handling show/hide
  const displayTransitions: Array<{
    element: HTMLElement;
    displayStart: string | null;
    displayEnd: string | null;
  }> = [];

  // Track SplitText instances for cleanup
  const splitTextInstances: SplitText[] = [];

  // Track split elements per layer to reuse across multiple tweens
  const splitElementsCache = new Map<string, HTMLElement[]>();

  const timeline = gsap.timeline({
    paused: true,
    repeat: interaction.timeline?.repeat ?? 0,
    yoyo: isYoyo,
    onComplete: () => {
      // Clean up split text after animation completes (optional)
      // splitTextInstances.forEach(split => split.revert());
    },
  });

  // First pass: prepare all elements, split text, and collect data
  interface PreparedTween {
    element: HTMLElement;
    splitElements?: HTMLElement[];
    from: gsap.TweenVars;
    to: gsap.TweenVars;
    displayStart: string | null;
    displayEnd: string | null;
    position: string | number;
    duration: number;
    ease: string;
    splitTextConfig?: typeof interaction.tweens[0]['splitText'];
  }
  const preparedTweens: PreparedTween[] = [];

  (interaction.tweens || []).forEach((tween, index) => {
    const element = getElement(tween.layer_id);
    if (!element) return;

    // Apply split text if configured using GSAP's SplitText
    let splitElements: HTMLElement[] | undefined;
    if (tween.splitText) {
      // Check if we've already split this element in this timeline
      const cacheKey = `${tween.layer_id}_${tween.splitText.type}`;

      if (splitElementsCache.has(cacheKey)) {
        // Reuse existing split elements
        splitElements = splitElementsCache.get(cacheKey);
      } else {
        // Create new split for this element
        const result = createSplitTextAnimation(
          element,
          tween.splitText,
          tween,
          gsap,
          SplitText
        );

        if (result) {
          splitTextInstances.push(result.splitInstance);
          splitElements = result.splitElements;
          // Cache the split elements for reuse
          splitElementsCache.set(cacheKey, result.splitElements);
        }
      }
    }

    const { from, to, displayStart, displayEnd } = buildGsapProps(tween);

    // Calculate position for timeline
    let position: string | number = 0;
    if (typeof tween.position === 'number') {
      position = tween.position;
    } else if (tween.position === '>' && index > 0) {
      position = '>';
    } else if (tween.position === '<' && index > 0) {
      position = '<';
    }

    // Track display transitions for this tween
    if (displayStart !== displayEnd) {
      displayTransitions.push({ element, displayStart, displayEnd });
    }

    preparedTweens.push({
      element,
      splitElements,
      from,
      to,
      displayStart,
      displayEnd,
      position,
      duration: tween.duration,
      ease: tween.ease,
      splitTextConfig: tween.splitText,
    });
  });

  // Second pass: Add all tweens to timeline
  // For each tween, apply its "from" state at the same position it starts
  preparedTweens.forEach(({ element, splitElements, from, to, displayStart, displayEnd, position, duration, ease, splitTextConfig }) => {
    // Apply the "from" state at the same position as the tween starts
    // This ensures sequenced animations have correct initial state when they begin
    if (Object.keys(from).length > 0) {
      const targets = splitElements && splitElements.length > 0 ? splitElements : element;
      timeline.set(targets, from, position);
    }

    // Add tween to timeline using shared utility
    addTweenToTimeline(timeline, {
      element,
      from,
      to,
      duration,
      ease,
      position,
      splitText: splitTextConfig,
      splitElements,
      onComplete: displayEnd === 'hidden'
        ? () => element.setAttribute('data-gsap-hidden', '')
        : undefined,
    });
  });

  // Handle display state changes based on timeline direction
  if (displayTransitions.length > 0) {
    // When timeline starts playing forward, set elements to their "end" display state
    timeline.eventCallback('onStart', () => {
      displayTransitions.forEach(({ element, displayEnd }) => {
        if (displayEnd === 'visible') {
          element.removeAttribute('data-gsap-hidden');
        }
      });
    });

    // When timeline reverses back to start, restore initial display states
    if (isYoyo) {
      timeline.eventCallback('onReverseComplete', () => {
        displayTransitions.forEach(({ element, displayStart }) => {
          if (displayStart === 'hidden') {
            element.setAttribute('data-gsap-hidden', '');
          } else {
            element.removeAttribute('data-gsap-hidden');
          }
        });
      });
    }
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// scroll-into-view reveal: IntersectionObserver-based (mirrors source FadeIn)
// ---------------------------------------------------------------------------

/**
 * Map a GSAP ScrollTrigger `start` keyword like "top 90%" or "top 85%" to a
 * matching IntersectionObserver `rootMargin`.
 *
 * The Studio importer emits `scroll-into-view` interactions that mirror the
 * source `<FadeIn>` component. Source FadeIn uses
 *   rootMargin: "-10% 0px -10% 0px"
 * which shrinks the viewport by 10% from BOTH top and bottom. We deliberately
 * mirror that here so headless fullPage screenshots match source visuals on
 * both sides of the page (header-region reveals + bottom-region reveals).
 *
 * The mapping treats `top X%` as "trigger when the element is at least
 * (100 - X)% inside the viewport from the bottom"; we apply the same shrink
 * symmetrically to top and bottom, matching source behaviour.
 */
function rootMarginFromScrollStart(scrollStart: string): string {
  const match = /\btop\s+(-?\d+(?:\.\d+)?)%/i.exec(scrollStart);
  if (match) {
    const percent = parseFloat(match[1]);
    if (Number.isFinite(percent) && percent > 0 && percent <= 100) {
      const shrink = 100 - percent; // 90% -> 10%, 85% -> 15%
      return `-${shrink}% 0px -${shrink}% 0px`;
    }
  }
  // Source default
  return '-10% 0px -10% 0px';
}

function parseToggleActionsOnce(toggleActions: string): boolean {
  // GSAP toggleActions: "onEnter onLeave onEnterBack onLeaveBack"
  // Only the exact importer/source FadeIn shape is treated as a one-shot IO
  // reveal. Other GSAP actions, including restart/reverse/resume patterns and
  // malformed values, stay on ScrollTrigger so generic Ycode interactions keep
  // their original semantics.
  const parts = toggleActions.trim().toLowerCase().split(/\s+/);
  return (
    parts.length === 4 &&
    parts[0] === 'play' &&
    parts[1] === 'none' &&
    parts[2] === 'none' &&
    parts[3] === 'none'
  );
}

function registerIntersectionReveal({
  element,
  timeline,
  rootMargin,
  once,
}: {
  element: HTMLElement;
  timeline: gsap.core.Timeline;
  rootMargin: string;
  once: boolean;
}): () => void {
  // Reduced-motion users (and SSR/JS-off as a side effect, since this code
  // never runs without JS) must not be left with hidden content. Play the
  // timeline immediately so the element ends up at its final state without
  // animation duration. GSAP respects motion preferences via individual tweens
  // already, but ScrollTrigger gating on visibility would still hide content.
  const reducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    timeline.progress(1);
    return () => {};
  }

  // Browsers without IntersectionObserver: fall back to playing immediately so
  // the element is never permanently hidden.
  if (typeof IntersectionObserver === 'undefined') {
    timeline.play();
    return () => {};
  }

  let disposed = false;

  const intersectsRootMargin = (rect: DOMRect, viewportH: number): boolean => {
    const parts = rootMargin.trim().split(/\s+/);
    const topMargin = parts[0] || '0px';
    const bottomMargin = parts[2] || parts[0] || '0px';
    const parseMargin = (value: string): number => {
      if (value.endsWith('%')) {
        const percent = Number(value.slice(0, -1));
        return Number.isFinite(percent) ? (viewportH * percent) / 100 : 0;
      }
      if (value.endsWith('px')) {
        const px = Number(value.slice(0, -2));
        return Number.isFinite(px) ? px : 0;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const rootTop = -parseMargin(topMargin);
    const rootBottom = viewportH + parseMargin(bottomMargin);
    return rect.top < rootBottom && rect.bottom > rootTop;
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          timeline.play();
          if (once) {
            observer.disconnect();
            disposed = true;
            return;
          }
        } else if (!once) {
          // For non-once toggleActions we honor the GSAP semantics by
          // restarting on subsequent enters; on leave we leave the timeline at
          // its current position (matching default ScrollTrigger behaviour).
        }
      }
    },
    { rootMargin },
  );

  observer.observe(element);

  // Edge case: when Playwright/Chromium captures a fullPage screenshot the
  // viewport is briefly resized to the document height. IntersectionObserver
  // posts entries asynchronously after layout, so we additionally check
  // whether the element already intersects after the next animation frame; if
  // it does and the observer hasn't fired yet (very rare), play directly.
  let rafId: number | null = null;
  if (typeof requestAnimationFrame === 'function') {
    rafId = requestAnimationFrame(() => {
      if (disposed) return;
      const rect = element.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const inView = intersectsRootMargin(rect, viewportH);
      if (inView && timeline.progress() === 0 && !timeline.isActive()) {
        timeline.play();
        if (once) {
          observer.disconnect();
          disposed = true;
        }
      }
    });
  }

  return () => {
    disposed = true;
    observer.disconnect();
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    }
  };
}

function waitForTimeout(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeoutId);
      resolve();
    }, { once: true });
  });
}

async function waitWithCap(task: Promise<unknown>, ms: number, signal: AbortSignal): Promise<void> {
  await Promise.race([
    task.catch(() => undefined),
    waitForTimeout(ms, signal),
  ]);
}

async function waitForWindowLoad(signal: AbortSignal): Promise<void> {
  if (document.readyState === 'complete' || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    window.addEventListener('load', done, { once: true });
    signal.addEventListener('abort', done, { once: true });
  });
}

async function waitForPageTransition(signal: AbortSignal): Promise<void> {
  const transition = document.querySelector<HTMLElement>('[data-studio-page-transition]');
  if (!transition || signal.aborted || typeof transition.getAnimations !== 'function') return;
  const animations = transition.getAnimations().filter((animation) => animation.playState !== 'finished');
  if (animations.length === 0) return;
  await waitWithCap(Promise.allSettled(animations.map((animation) => animation.finished)), 900, signal);
}

async function waitForStudioPreviewRenderedReady(signal: AbortSignal): Promise<void> {
  await waitWithCap(Promise.allSettled([
    document.fonts?.ready || Promise.resolve(),
    waitForWindowLoad(signal),
  ]), 2500, signal);
  await waitForPageTransition(signal);
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function getVisiblePreviewLayerCount(): { visibleLayerCount: number; contentLayerCount: number } {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-layer-id]'))
    .reduce((counts, element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const isVisible = rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0;
      if (!isVisible) return counts;

      counts.visibleLayerCount += 1;
      const layerId = element.getAttribute('data-layer-id') || '';
      const isScaffold = layerId === 'body' || element.id === 'ybody';
      if (!isScaffold) {
        counts.contentLayerCount += 1;
      }
      return counts;
    }, { visibleLayerCount: 0, contentLayerCount: 0 });
}

function buildPreviewClientHeartbeat() {
  const bodyRect = document.body.getBoundingClientRect();
  const { visibleLayerCount, contentLayerCount } = getVisiblePreviewLayerCount();
  const bodyTextLength = (document.body.innerText || '').trim().length;
  const bodyVisible = bodyRect.width > 0 && bodyRect.height > 0;
  const viewportWidth = Math.round(window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
  return {
    bodyVisible,
    viewportWidth,
    viewportHeight,
    bodyWidth: Math.round(bodyRect.width),
    bodyHeight: Math.round(bodyRect.height),
    visibleLayerCount,
    contentLayerCount,
    bodyTextLength,
    ok: bodyVisible && visibleLayerCount > 0 && contentLayerCount > 0,
  };
}

export default function AnimationInitializer({ layers, injectInitialCSS, initializeGlobalRuntime = false }: AnimationInitializerProps) {
  const cleanupRef = useRef<(() => void)[]>([]);
  const timelinesRef = useRef<Map<string, gsap.core.Timeline>>(new Map());
  const prevBreakpointRef = useRef<Breakpoint | null>(null);
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>(() => getCurrentBreakpoint());
  const [previewLocationKey, setPreviewLocationKey] = useState('');
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!initializeGlobalRuntime || typeof window === 'undefined') return;
    const readLocation = () => `${window.location.pathname}${window.location.search}`;
    const updateLocation = () => {
      const nextLocation = readLocation();
      setPreviewLocationKey((previousLocation) => (
        previousLocation === nextLocation ? previousLocation : nextLocation
      ));
    };

    updateLocation();
    const intervalId = window.setInterval(updateLocation, 250);
    window.addEventListener('popstate', updateLocation);
    window.addEventListener('hashchange', updateLocation);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('popstate', updateLocation);
      window.removeEventListener('hashchange', updateLocation);
    };
  }, [initializeGlobalRuntime]);

  useEffect(() => {
    if (!initializeGlobalRuntime || typeof window === 'undefined') return;
    const previewContext = getStudioPreviewReportContext(window.location, previewLocationKey);
    if (!previewContext) return;
    const { previewUrl, previewProjectParam } = previewContext;

    const controller = new AbortController();
    waitForStudioPreviewRenderedReady(controller.signal).then(() => {
      if (controller.signal.aborted) return;
      const clientHeartbeat = buildPreviewClientHeartbeat();
      if (!clientHeartbeat.ok) return;
      studioFetch('/ycode/api/studio/preview-rendered', {
        method: 'POST',
        headers: previewProjectParam
          ? { 'content-type': 'application/json', 'x-studio-project-slug': previewProjectParam }
          : { 'content-type': 'application/json' },
        body: JSON.stringify({ previewUrl, clientHeartbeat }),
        credentials: 'same-origin',
        signal: controller.signal,
      }).then((response) => {
        if (response.ok) {
          window.localStorage?.setItem('studio:last-rendered-preview-url', previewUrl);
          window.dispatchEvent(new CustomEvent('studio:preview-rendered', { detail: { previewUrl } }));
        }
      }).catch(() => {
        // The publish gate reports a clear error if no rendered preview is recorded.
      });
    });

    return () => controller.abort();
  }, [initializeGlobalRuntime, previewLocationKey]);

  // Inject initial animation CSS for subtrees not covered by the page-level style tag
  // (e.g. components embedded in rich text whose layer IDs are namespaced differently)
  useEffect(() => {
    if (!injectInitialCSS) return;
    const { css, hiddenLayerInfo } = generateInitialAnimationCSS(layers);
    if (css) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      styleRef.current = style;

      // Apply data-gsap-hidden to elements that should start hidden
      hiddenLayerInfo.forEach(({ layerId, breakpoints }) => {
        const el = getElement(layerId);
        if (el) {
          el.setAttribute('data-gsap-hidden', breakpoints || '');
        }
      });
    }
    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, [injectInitialCSS, layers]);

  // Listen for breakpoint changes on resize
  useEffect(() => {
    const handleResize = () => {
      const newBreakpoint = getCurrentBreakpoint();
      setCurrentBreakpoint((prev) => (prev !== newBreakpoint ? newBreakpoint : prev));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const collectedInteractions = collectInteractions(layers);
    const hiddenLayerInfo = collectHiddenLayerInfo(collectedInteractions);
    const isBreakpointChange = prevBreakpointRef.current !== null && prevBreakpointRef.current !== currentBreakpoint;

    // Reset animation states when breakpoint changes
    if (isBreakpointChange) {
      resetAnimationStates(collectedInteractions, hiddenLayerInfo, currentBreakpoint);
    }

    // Update previous breakpoint reference
    prevBreakpointRef.current = currentBreakpoint;

    // Clean up previous animations
    cleanupRef.current.forEach((cleanup) => cleanup());
    cleanupRef.current = [];
    timelinesRef.current.forEach((tl) => tl.kill());
    timelinesRef.current.clear();

    collectedInteractions.forEach(({ triggerLayerId, interaction }) => {
      const triggerElement = getElement(triggerLayerId);
      if (!triggerElement) return;

      const { trigger } = interaction;

      // Helper to get or create timeline (always lazy to avoid GSAP setting inline styles)
      // Initial styles are handled by CSS via generateInitialAnimationCSS()
      const getTimeline = (): gsap.core.Timeline | null => {
        let tl = timelinesRef.current.get(interaction.id) || null;
        if (!tl) {
          tl = buildTimeline(interaction);
          if (tl) timelinesRef.current.set(interaction.id, tl);
        }
        return tl;
      };

      switch (trigger) {
        case 'load': {
          // Skip if breakpoint restriction not met
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;

          const timeline = getTimeline();
          timeline?.play();
          break;
        }

        case 'click': {
          let isForward = true;
          const isLooped = (interaction.timeline?.repeat ?? 0) !== 0;

          const handleClick = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;

            const timeline = getTimeline();
            if (!timeline) return;

            if (isLooped) {
              if (timeline.isActive()) {
                timeline.pause();
              } else {
                timeline.play();
              }
            } else if (interaction.timeline?.yoyo) {
              if (isForward) {
                timeline.play();
              } else {
                timeline.reverse();
              }
              isForward = !isForward;
            } else {
              timeline.restart();
            }
          };

          triggerElement.addEventListener('click', handleClick);
          if (triggerElement.matches('[data-studio-mobile-drawer-trigger]') && interaction.timeline?.yoyo) {
            mobileDrawerTriggerTimelineControls.set(triggerElement, {
              reverse: () => {
                const timeline = getTimeline();
                timeline?.reverse();
                isForward = true;
              },
            });
          }
          cleanupRef.current.push(() => {
            triggerElement.removeEventListener('click', handleClick);
            mobileDrawerTriggerTimelineControls.delete(triggerElement);
          });
          break;
        }

        case 'hover': {
          const handleMouseEnter = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;
            getTimeline()?.play();
          };
          const handleMouseLeave = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;
            if (interaction.timeline?.yoyo) {
              timelinesRef.current.get(interaction.id)?.reverse();
            }
          };

          triggerElement.addEventListener('mouseenter', handleMouseEnter);
          triggerElement.addEventListener('mouseleave', handleMouseLeave);
          cleanupRef.current.push(() => {
            triggerElement.removeEventListener('mouseenter', handleMouseEnter);
            triggerElement.removeEventListener('mouseleave', handleMouseLeave);
          });
          break;
        }

        case 'scroll-into-view': {
          // Skip if breakpoint restriction not met
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;

          const scrollStart = interaction.timeline?.scrollStart || 'top 80%';
          const toggleActions = interaction.timeline?.toggleActions ?? 'play none none none';

          const onceForReveal = (interaction as LayerInteraction & { studioImportReveal?: boolean }).studioImportReveal === true
            && parseToggleActionsOnce(toggleActions);
          if (onceForReveal) {
            // Mirror the source FadeIn pattern for one-shot reveals: prefer
            // IntersectionObserver because it correctly fires when
            // Playwright/Chromium expands the viewport for a fullPage screenshot,
            // where ScrollTrigger never enters because it tracks scrollY rather
            // than actual viewport intersection.
            const rootMargin = rootMarginFromScrollStart(scrollStart);
            let revealCount = 0;

            for (const tween of interaction.tweens || []) {
              const targetElement = getElement(tween.layer_id);
              if (!targetElement) continue;

              const revealTimelineId = `${interaction.id}:${tween.id}:intersection`;
              const revealTimeline = buildTimeline({
                ...interaction,
                id: revealTimelineId,
                tweens: [tween],
              });
              if (!revealTimeline) continue;

              timelinesRef.current.set(revealTimelineId, revealTimeline);
              cleanupRef.current.push(registerIntersectionReveal({
                element: targetElement,
                timeline: revealTimeline,
                rootMargin,
                once: true,
              }));
              revealCount += 1;
            }

            if (revealCount === 0) {
              const timeline = getTimeline();
              if (!timeline) break;
              cleanupRef.current.push(registerIntersectionReveal({
                element: triggerElement,
                timeline,
                rootMargin,
                once: true,
              }));
            }
          } else {
            // toggleActions requires timeline upfront
            const timeline = getTimeline();
            if (!timeline) break;

            // Preserve generic Ycode ScrollTrigger semantics for user-authored
            // scroll interactions that rely on reverse/restart/reset
            // toggleActions. The importer only uses one-shot FadeIn reveals for
            // source-backed snapshots, so the IO path remains scoped to that
            // source-fidelity case.
            const scrollTrigger = ScrollTrigger.create({
              trigger: triggerElement,
              start: scrollStart,
              animation: timeline,
              toggleActions,
            });

            cleanupRef.current.push(() => scrollTrigger.kill());
          }
          break;
        }

        case 'while-scrolling': {
          // Skip if breakpoint restriction not met
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;

          // Scrub animations require timeline upfront
          const timeline = getTimeline();
          if (!timeline) break;

          const scrollStart = interaction.timeline?.scrollStart || 'top bottom';
          const scrollEnd = interaction.timeline?.scrollEnd || 'bottom top';
          const scrub = interaction.timeline?.scrub ?? 1;

          const scrollTrigger = ScrollTrigger.create({
            trigger: triggerElement,
            start: scrollStart,
            end: scrollEnd,
            scrub,
            animation: timeline,
          });

          cleanupRef.current.push(() => scrollTrigger.kill());
          break;
        }
      }
    });

    const studioRuntimeProfile = document
      .querySelector<HTMLElement>('[data-studio-runtime-profile]')
      ?.getAttribute('data-studio-runtime-profile');
    const studioRuntimeAdapters = document
      .querySelector<HTMLElement>('[data-studio-runtime-adapters]')
      ?.getAttribute('data-studio-runtime-adapters')
      ?.split(/\s+/)
      .filter(Boolean) || [];
    const isHrRuntimeProfile = studioRuntimeProfile === 'hr-interim-solutions';
    const hasRuntimeAdapter = (adapter: string): boolean => (
      isHrRuntimeProfile && studioRuntimeAdapters.includes(`hr.${adapter}`)
    );

    if (initializeGlobalRuntime) {
      cleanupRef.current.push(...initializeStudioPreviewProjectLinks());
    }

    if (initializeGlobalRuntime && isHrRuntimeProfile) {
      if (hasRuntimeAdapter('counters')) {
        cleanupRef.current.push(...initializeStudioCounters());
      }
      if (hasRuntimeAdapter('mobile-drawer')) {
        cleanupRef.current.push(...initializeStudioMobileDrawer());
      }
      if (hasRuntimeAdapter('page-transition')) {
        cleanupRef.current.push(...initializeStudioPageTransition());
      }
      if (hasRuntimeAdapter('site-header')) {
        cleanupRef.current.push(...initializeStudioActiveNav());
        cleanupRef.current.push(...initializeStudioHeaderScroll());
      }
      if (hasRuntimeAdapter('feature-tabs')) {
        cleanupRef.current.push(...initializeStudioFeatureTabs());
      }
    }

    // Capture ref values for cleanup
    const cleanups = cleanupRef.current;
    const timelines = timelinesRef.current;

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      timelines.forEach((tl) => tl.kill());
    };
  }, [layers, currentBreakpoint]);

  return null;
}
