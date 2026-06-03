'use client';

import { useEffect } from 'react';

const mobileDrawerBodyLocks = new Set<HTMLElement>();
let mobileDrawerPreviousBodyOverflow: string | null = null;

function setStudioImportSystemValues(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLElement>('[data-studio-import-system-value][name]').forEach((element) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    const systemValue = element.getAttribute('data-studio-import-system-value');
    if (systemValue === 'submission-timestamp-ms') {
      element.value = String(Date.now());
    } else if (systemValue === 'honeypot-empty' && !element.value) {
      element.value = '';
    }
  });
}

function buildStudioFormPayload(form: HTMLFormElement): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const formData = new FormData(form);

  formData.forEach((value, key) => {
    const existing = payload[key];
    if (existing === undefined) {
      payload[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      payload[key] = [existing, value];
    }
  });

  form.querySelectorAll<HTMLSelectElement>('select[name]').forEach((select) => {
    if (!select.name || select.selectedIndex < 0) return;
    const selectedOption = select.options[select.selectedIndex];
    if (selectedOption?.value && selectedOption.text && selectedOption.value !== selectedOption.text) {
      payload[select.name] = selectedOption.text;
    }
  });

  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((checkbox) => {
    if (checkbox.name && !(checkbox.name in payload)) {
      payload[checkbox.name] = 'false';
    }
  });

  form.querySelectorAll<HTMLElement>('[data-studio-import-field-name][data-studio-import-payload-type]').forEach((field) => {
    const fieldName = field.getAttribute('data-studio-import-field-name');
    const payloadType = field.getAttribute('data-studio-import-payload-type');
    if (!fieldName || !payloadType || !(fieldName in payload)) return;

    const value = payload[fieldName];
    if (payloadType === 'boolean') {
      payload[fieldName] = value === true || value === 'true' || value === 'on' || value === '1';
    } else if (payloadType === 'number') {
      const nextValue = Array.isArray(value) ? value[0] : value;
      const numberValue = Number(nextValue);
      payload[fieldName] = Number.isFinite(numberValue) ? numberValue : null;
    } else if (payloadType === 'stringArray') {
      if (Array.isArray(value)) {
        payload[fieldName] = value.map(String).filter((item) => item !== 'false');
      } else if (value === 'false' || value === false || value == null) {
        payload[fieldName] = [];
      } else {
        payload[fieldName] = [String(value)];
      }
    } else if (Array.isArray(value)) {
      payload[fieldName] = value.map(String);
    } else if (value != null) {
      payload[fieldName] = String(value);
    }
  });

  return payload;
}

function parseStudioFormEmail(form: HTMLFormElement): unknown {
  const rawEmail = form.dataset.studioFormEmail;
  if (!rawEmail) return undefined;
  try {
    return JSON.parse(rawEmail);
  } catch {
    return undefined;
  }
}

function initializeStudioForms(): Array<() => void> {
  const forms = Array.from(
    document.querySelectorAll<HTMLFormElement>('form[data-studio-import-submit-mode], form[data-studio-import-submit-endpoint], form[data-studio-import-form]'),
  );
  if (forms.length === 0) return [];

  const cleanups: Array<() => void> = [];

  for (const form of forms) {
    const onSubmit = async (event: SubmitEvent) => {
      event.preventDefault();

      const submitButton = form.querySelector<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"]');
      const successAlert = form.querySelector<HTMLElement>('[data-alert-type="success"]');
      const errorAlert = form.querySelector<HTMLElement>('[data-alert-type="error"]');

      if (successAlert) successAlert.style.display = 'none';
      if (errorAlert) errorAlert.style.display = 'none';

      setStudioImportSystemValues(form);

      if (submitButton) submitButton.disabled = true;
      try {
        const response = await fetch('/ycode/api/form-submissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_id: form.dataset.studioImportForm || form.getAttribute('id') || 'unnamed-form',
            payload: buildStudioFormPayload(form),
            metadata: {
              page_url: window.location.href,
            },
            email: parseStudioFormEmail(form),
          }),
        });

        if (!response.ok) {
          throw new Error(`Form submission failed with ${response.status}`);
        }

        form.reset();
        if (form.dataset.studioFormSuccessAction === 'redirect' && form.dataset.studioFormRedirectHref) {
          window.location.href = form.dataset.studioFormRedirectHref;
        } else if (successAlert) {
          successAlert.style.display = '';
        }
      } catch {
        if (errorAlert) errorAlert.style.display = '';
      } finally {
        if (submitButton) submitButton.disabled = false;
      }
    };

    form.addEventListener('submit', onSubmit);
    cleanups.push(() => form.removeEventListener('submit', onSubmit));
  }

  return cleanups;
}

function formatCounterValue(value: number, prefix: string, suffix: string): string {
  return `${prefix}${Math.round(value).toLocaleString('de-DE')}${suffix}`;
}

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

    const onTriggerClick = () => {
      if (isClosing()) {
        open();
      } else if (isOpen()) {
        close(false, true);
      } else {
        open();
      }
    };

    const closeAndSync = (returnFocus = true) => {
      close(returnFocus, true);
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
        closeAndSync(false);
      }
    };

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

function initializeStudioPageTransition(): Array<() => void> {
  const target = document.querySelector<HTMLElement>('[data-studio-page-transition]');
  if (!target) return [];
  if (target.dataset.studioPageTransitionRan === '1') return [];

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const isMobile = window.matchMedia?.('(max-width: 767px)').matches ?? false;
  if (reduce || isMobile || typeof target.animate !== 'function') {
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
    return [() => {
      target.removeEventListener('animationend', clearWillChange);
      clearWillChange();
    }];
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

  return [() => {
    animation.cancel();
    target.style.willChange = previousWillChange;
  }];
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

export default function StudioRuntimeInitializer() {
  useEffect(() => {
    const runtimeProfile = document
      .querySelector<HTMLElement>('[data-studio-runtime-profile]')
      ?.getAttribute('data-studio-runtime-profile');
    const runtimeAdapters = document
      .querySelector<HTMLElement>('[data-studio-runtime-adapters]')
      ?.getAttribute('data-studio-runtime-adapters')
      ?.split(/\s+/)
      .filter(Boolean) || [];
    const isHrRuntimeProfile = runtimeProfile === 'hr-interim-solutions';
    const hasRuntimeAdapter = (adapter: string): boolean => (
      isHrRuntimeProfile && runtimeAdapters.includes(`hr.${adapter}`)
    );
    if (!isHrRuntimeProfile) return undefined;

    const cleanups: Array<() => void> = [];
    if (hasRuntimeAdapter('counters')) {
      cleanups.push(...initializeStudioCounters());
    }
    if (hasRuntimeAdapter('mobile-drawer')) {
      cleanups.push(...initializeStudioMobileDrawer());
    }
    if (hasRuntimeAdapter('page-transition')) {
      cleanups.push(...initializeStudioPageTransition());
    }
    if (hasRuntimeAdapter('site-header')) {
      cleanups.push(...initializeStudioActiveNav());
      cleanups.push(...initializeStudioHeaderScroll());
    }
    if (hasRuntimeAdapter('feature-tabs')) {
      cleanups.push(...initializeStudioFeatureTabs());
    }
    if (hasRuntimeAdapter('forms') || document.querySelector('form[data-studio-import-submit-mode], form[data-studio-import-submit-endpoint]')) {
      cleanups.push(...initializeStudioForms());
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return null;
}
