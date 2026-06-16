'use client';

/**
 * Client-Side CSS Generator using Tailwind Browser CDN
 *
 * Uses @tailwindcss/browser in a hidden iframe to generate CSS
 * This avoids all WASM bundling issues
 */

import { studioFetch } from '@/lib/api';
import type { Layer } from '@/types';
import { DEFAULT_TEXT_STYLES } from '@/lib/text-format-utils';
import { TAILWIND_CUSTOM_VARIANTS } from '@/lib/tailwind-custom-variants';

/**
 * Extract all classes from layers recursively
 * Includes classes from layer.classes, layer.textStyles, and DEFAULT_TEXT_STYLES
 * Tracks processed componentIds to avoid duplicate child-subtree extraction
 */
function extractClassesFromLayers(layers: Layer[]): Set<string> {
  const classes = new Set<string>();
  const processedComponentIds = new Set<string>();

  // Helper to extract classes from a string or array
  const extractClasses = (classValue: string | string[] | undefined) => {
    if (!classValue) return;

    if (Array.isArray(classValue)) {
      classValue.forEach(cls => {
        if (cls && typeof cls === 'string') {
          cls.split(/\s+/).forEach(c => c.trim() && classes.add(c.trim()));
        }
      });
    } else if (typeof classValue === 'string') {
      classValue.split(/\s+/).forEach(cls => cls.trim() && classes.add(cls.trim()));
    }
  };

  function processLayer(layer: Layer): void {
    if (layer.settings?.hidden) return;

    // Per-instance classes/styles must always be collected (the Set dedupes), even for
    // repeated component instances — otherwise a second instance's class overrides are lost.
    extractClasses(layer.classes);

    // Extract text style classes (from layer.textStyles)
    if (layer.textStyles) {
      Object.values(layer.textStyles).forEach(style => {
        extractClasses(style.classes);
      });
    }

    // Extract default text style classes (if layer has text content)
    if (layer.variables?.text) {
      Object.values(DEFAULT_TEXT_STYLES).forEach(style => {
        extractClasses(style.classes);
      });
    }

    // Guard only the children recursion against repeated component subtrees.
    if (layer.componentId) {
      if (processedComponentIds.has(layer.componentId)) return;
      processedComponentIds.add(layer.componentId);
    }

    if (layer.children && Array.isArray(layer.children)) {
      layer.children.forEach(child => processLayer(child));
    }
  }

  layers.forEach(layer => processLayer(layer));
  return classes;
}

/**
 * Generate CSS using Tailwind Browser CDN in a hidden iframe
 */
export async function generateCSS(layers: Layer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const classes = extractClassesFromLayers(layers);
    const classesArray = Array.from(classes);

    if (classesArray.length === 0) {
      resolve('/* No classes to generate */');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handleMessage);
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
      reject(new Error('CSS generation timeout'));
    }, 30000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'css-ready') {
        clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        resolve(event.data.css);
      } else if (event.data.type === 'css-error') {
        clearTimeout(timeout);
        window.removeEventListener('message', handleMessage);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        reject(new Error(event.data.error));
      }
    };
    window.addEventListener('message', handleMessage);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      document.body.removeChild(iframe);
      reject(new Error('Cannot access iframe document'));
      return;
    }

    const htmlContent = classesArray.map(cls => `<div class="${cls}"></div>`).join('\n');

    iframeDoc.open();
    iframeDoc.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <style type="text/tailwindcss">
    ${TAILWIND_CUSTOM_VARIANTS}
  </style>
</head>
<body>
  ${htmlContent}
  <script>
    let retryCount = 0;
    const maxRetries = 100;

    function extractCSS() {
      try {
        retryCount++;
        const styleTags = Array.from(document.querySelectorAll('style'));

        const tailwindStyle = styleTags.find(style => {
          const css = style.textContent || '';
          return css.length > 100 && (
            css.includes('*,::after,::before') ||
            css.includes('tailwindcss') ||
            css.includes('--tw-')
          );
        });

        if (tailwindStyle && tailwindStyle.textContent) {
          window.parent.postMessage({
            type: 'css-ready',
            css: tailwindStyle.textContent
          }, '*');
        } else if (retryCount >= maxRetries) {
          window.parent.postMessage({
            type: 'css-error',
            error: 'CSS generation timeout'
          }, '*');
        } else {
          setTimeout(extractCSS, 100);
        }
      } catch (error) {
        window.parent.postMessage({
          type: 'css-error',
          error: error.message || 'Unknown error'
        }, '*');
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(extractCSS, 1000);
      });
    } else {
      setTimeout(extractCSS, 1000);
    }
  </script>
</body>
</html>
    `);
    iframeDoc.close();
  });
}

/**
 * Save CSS to settings via API and update the settings store
 */
export async function saveCSS(css: string, key: 'draft_css' | 'published_css'): Promise<void> {
  const response = await studioFetch(`/ycode/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: css }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save CSS: ${response.statusText}`);
  }

  // Update settings store to keep it in sync
  const { useSettingsStore } = await import('@/stores/useSettingsStore');
  useSettingsStore.getState().updateSetting(key, css);
}

/**
 * Generate CSS and save it to draft_css.
 *
 * Studio uses the server-side Tailwind compiler as the source of truth here.
 * The browser CDN compiler drops complex arbitrary font-family utilities like
 * `font-[family-name:var(--font-display,"Spectral",Georgia,serif)]`, which
 * poisons draft_css and makes authenticated preview diverge from published.
 */
export async function generateAndSaveCSS(_layers: Layer[] = []): Promise<string> {
  const response = await studioFetch('/ycode/api/css/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    let message = response.statusText || 'Failed to generate CSS';
    try {
      const payload = await response.json();
      if (typeof payload?.error === 'string') message = payload.error;
    } catch {
      // Keep the HTTP status text fallback.
    }
    throw new Error(message);
  }

  return '';
}
