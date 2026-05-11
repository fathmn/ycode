'use client';

/**
 * Canvas Component
 *
 * Renders the layer editor canvas using an embedded iframe with Tailwind Browser CDN.
 * The iframe provides complete style isolation while allowing React-based layer rendering.
 *
 * Architecture:
 * - An iframe is created with Tailwind Browser CDN loaded
 * - React components are rendered into the iframe via ReactDOM.createRoot
 * - Communication happens via direct function calls (no postMessage needed)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';

import LayerRenderer from '@/components/LayerRenderer';
import { serializeLayers, getClassesString } from '@/lib/layer-utils';
import { collectEditorHiddenLayerIds } from '@/lib/animation-utils';
import { getCanvasIframeHtml, updateViewportOverrides, measureContentExtent } from '@/lib/canvas-utils';
import { CanvasPortalProvider } from '@/lib/canvas-portal-context';
import { cn } from '@/lib/utils';
import { loadSwiperCss } from '@/lib/slider-utils';
import { resolveReferenceFieldsSync } from '@/lib/collection-utils';
import { useEditorStore } from '@/stores/useEditorStore';
import { useFontsStore } from '@/stores/useFontsStore';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';

import type { Layer, Component, CollectionItemWithValues, CollectionField, Breakpoint, Asset, ComponentVariable } from '@/types';
import type { UseLiveLayerUpdatesReturn } from '@/hooks/use-live-layer-updates';
import type { UseLiveComponentUpdatesReturn } from '@/hooks/use-live-component-updates';

interface CanvasProps {
  /** Layers to render */
  layers: Layer[];
  /** Components for resolving component instances */
  components: Component[];
  /** Currently selected layer ID */
  selectedLayerId: string | null;
  /** Currently hovered layer ID */
  hoveredLayerId: string | null;
  /** Current breakpoint/viewport mode */
  breakpoint: Breakpoint;
  /** Active UI state for preview (hover, focus, etc.) */
  activeUIState: 'neutral' | 'hover' | 'focus' | 'active' | 'disabled' | 'current';
  /** Whether a component is being edited */
  editingComponentId: string | null;
  /** Collection items by collection ID */
  collectionItems: Record<string, CollectionItemWithValues[]>;
  /** Collection fields by collection ID */
  collectionFields: Record<string, CollectionField[]>;
  /** Collection item for dynamic page preview */
  pageCollectionItem?: CollectionItemWithValues | null;
  /** Collection fields for dynamic page */
  pageCollectionFields?: CollectionField[];
  /** Assets map */
  assets: Record<string, Asset>;
  /** Collection layer data by layer ID */
  collectionLayerData: Record<string, CollectionItemWithValues[]>;
  /** Page ID */
  pageId: string;
  /** Callback when a layer is clicked */
  onLayerClick?: (layerId: string, event?: React.MouseEvent) => void;
  /** Callback when a layer is updated */
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  /** Callback when delete key is pressed */
  onDeleteLayer?: () => void;
  /** Callback when content height changes */
  onContentHeightChange?: (height: number) => void;
  /** Callback when content width changes (used in component editing mode) */
  onContentWidthChange?: (width: number) => void;
  /** Callback when gap is updated */
  onGapUpdate?: (layerId: string, gapValue: string) => void;
  /** Callback when zoom gesture is detected */
  onZoomGesture?: (delta: number) => void;
  /** Callback when zoom in is triggered (Cmd++) */
  onZoomIn?: () => void;
  /** Callback when zoom out is triggered (Cmd+-) */
  onZoomOut?: () => void;
  /** Callback when reset zoom is triggered (Cmd+0) */
  onResetZoom?: () => void;
  /** Callback when zoom to fit is triggered (Cmd+1) */
  onZoomToFit?: () => void;
  /** Callback when autofit is triggered (Cmd+2) */
  onAutofit?: () => void;
  /** Callback when undo is triggered (Cmd+Z) */
  onUndo?: () => void;
  /** Callback when redo is triggered (Cmd+Shift+Z) */
  onRedo?: () => void;
  /** Live layer updates for collaboration */
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  /** Live component updates for collaboration */
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  /** Callback when iframe is ready, provides the iframe element */
  onIframeReady?: (iframeElement: HTMLIFrameElement) => void;
  /** Callback when a layer is hovered (for external overlay) */
  onLayerHover?: (layerId: string | null) => void;
  /** Callback when any click occurs inside the canvas (for closing panels) */
  onCanvasClick?: () => void;
  /** Component variables when editing a component (for default value display) */
  editingComponentVariables?: ComponentVariable[];
  /** Disable editor hidden layers (e.g., when Interactions panel is active) */
  disableEditorHiddenLayers?: boolean;
  /** Current canvas zoom percentage (100 = 100%) */
  zoom?: number;
  /** Fixed viewport height for stable measurement of content using vh/svh/dvh units */
  referenceViewportHeight?: number;
}

/**
 * Inner component that renders inside the iframe
 */
interface CanvasContentProps {
  layers: Layer[];
  selectedLayerId: string | null;
  hoveredLayerId: string | null;
  pageId: string;
  pageCollectionItemId?: string;
  pageCollectionItemData: Record<string, string> | null;
  onLayerClick: (layerId: string, event?: React.MouseEvent) => void;
  onLayerUpdate?: (layerId: string, updates: Partial<Layer>) => void;
  onLayerHover: (layerId: string | null) => void;
  liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
  editingComponentVariables?: ComponentVariable[];
  editingComponentId?: string | null;
  editorHiddenLayerIds?: Map<string, Breakpoint[]>;
  editorBreakpoint?: Breakpoint;
  zoom?: number;
}

function CanvasContent({
  layers,
  selectedLayerId,
  hoveredLayerId,
  pageId,
  pageCollectionItemId,
  pageCollectionItemData,
  onLayerClick,
  onLayerUpdate,
  onLayerHover,
  liveLayerUpdates,
  liveComponentUpdates,
  editingComponentVariables,
  editingComponentId,
  editorHiddenLayerIds,
  editorBreakpoint,
  zoom = 100,
}: CanvasContentProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Seed ancestor set with the component being edited so its own rich-text
  // collection data cannot re-embed itself (prevents infinite loops)
  const initialAncestorIds = useMemo(
    () => editingComponentId ? new Set([editingComponentId]) : undefined,
    [editingComponentId]
  );

  // Select body layer when clicking on empty canvas space.
  // The #canvas-body div uses display:contents so it has no box — clicks on
  // empty space land on the iframe <body> (or sometimes <html> / one of the
  // display:contents wrappers), which is outside the React root and therefore
  // outside the layer onClick chain. We attach a native listener on the iframe
  // document so any click that doesn't end up on an actual layer element
  // (i.e. nothing with [data-layer-id] except the body wrapper itself) falls
  // through to selecting the Body layer.
  useEffect(() => {
    if (!bodyRef.current) return;
    const iframeDoc = bodyRef.current.ownerDocument;
    const iframeBody = iframeDoc.body;

    setPortalContainer(iframeBody);

    const handleBodyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Walk up from the click target. If we find any layer element with
      // data-layer-id !== 'body', that layer's own onClick handles selection
      // and we should ignore this fallthrough. Otherwise the click landed on
      // empty body space (or html / the display:contents wrappers) and we
      // select the Body layer.
      const layerEl = target.closest?.('[data-layer-id]') as HTMLElement | null;
      if (layerEl && layerEl.getAttribute('data-layer-id') !== 'body') return;
      onLayerClick('body');
    };

    iframeDoc.addEventListener('click', handleBodyClick);
    return () => iframeDoc.removeEventListener('click', handleBodyClick);
  }, [onLayerClick]);

  const bodyLayer = layers.find(l => l.id === 'body');
  const bodyClasses = bodyLayer ? getClassesString(bodyLayer) : '';
  const bodyRuntimeProfile = typeof bodyLayer?.attributes?.['data-studio-runtime-profile'] === 'string'
    ? bodyLayer.attributes['data-studio-runtime-profile']
    : undefined;
  const bodyRuntimeAdapters = typeof bodyLayer?.attributes?.['data-studio-runtime-adapters'] === 'string'
    ? bodyLayer.attributes['data-studio-runtime-adapters']
    : undefined;
  const childLayers = bodyLayer
    ? [...(bodyLayer.children || []), ...layers.filter(l => l.id !== 'body')]
    : layers;

  // Move body layer classes from #canvas-body to the iframe's <body> element
  useEffect(() => {
    if (!bodyRef.current) return;
    const iframeBody = bodyRef.current.ownerDocument.body;
    const resolvedClasses = editingComponentId
      ? 'bg-transparent relative'
      : (bodyClasses || 'bg-white');
    const classes = resolvedClasses.split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      iframeBody.classList.add(...classes);
      classes.forEach(c => bodyRef.current?.classList.remove(c));
    }
    return () => {
      if (classes.length > 0) {
        iframeBody.classList.remove(...classes);
      }
    };
  }, [bodyClasses, editingComponentId]);

  const portalValue = useMemo(
    () => ({ container: portalContainer, zoom }),
    [portalContainer, zoom]
  );

  // Body-layer runtime attributes scope imported interaction/style adapters.
  // In the published renderer they live on the body/main boundary; in the
  // editor iframe the global header/footer are rendered as body children, so
  // mirror the attributes to the iframe body and canvas root.
  useEffect(() => {
    if (!bodyRef.current) return;

    const canvasBody = bodyRef.current;
    const iframeBody = canvasBody.ownerDocument.body;
    const runtimeAttrs = [
      ['data-studio-runtime-profile', bodyRuntimeProfile],
      ['data-studio-runtime-adapters', bodyRuntimeAdapters],
    ] as const;

    for (const [name, value] of runtimeAttrs) {
      if (value) {
        iframeBody.setAttribute(name, value);
        canvasBody.setAttribute(name, value);
      } else {
        iframeBody.removeAttribute(name);
        canvasBody.removeAttribute(name);
      }
    }

    return () => {
      for (const [name] of runtimeAttrs) {
        iframeBody.removeAttribute(name);
        canvasBody.removeAttribute(name);
      }
    };
  }, [bodyRuntimeProfile, bodyRuntimeAdapters]);

  // The editor canvas can simulate desktop/tablet/mobile independently from the
  // browser viewport. Expose the selected breakpoint to canvas CSS so imported
  // responsive helpers are driven by the Studio toolbar state, not by stale
  // external CSS cache or parent chrome dimensions.
  useEffect(() => {
    if (!bodyRef.current || !editorBreakpoint) return;
    const canvasBody = bodyRef.current;
    const iframeDoc = bodyRef.current.ownerDocument;
    iframeDoc.body.setAttribute('data-ycode-editor-breakpoint', editorBreakpoint);
    canvasBody.setAttribute('data-ycode-editor-breakpoint', editorBreakpoint);
    return () => {
      iframeDoc.body.removeAttribute('data-ycode-editor-breakpoint');
      canvasBody.removeAttribute('data-ycode-editor-breakpoint');
    };
  }, [editorBreakpoint]);

  // Runtime adapters such as AnimationInitializer run in the published/preview
  // document, but the editor canvas renders layers into an iframe from the
  // parent React runtime. Initialize the imported mobile drawer against the
  // iframe's own document so canvas interactions match preview behavior.
  useEffect(() => {
    if (!bodyRef.current) return;

    const iframeDoc = bodyRef.current.ownerDocument;
    const iframeWindow = iframeDoc.defaultView;
    if (!iframeWindow) return;

    const drawers = Array.from(
      iframeDoc.querySelectorAll<HTMLElement>('[data-studio-mobile-drawer]')
    );
    if (drawers.length === 0) return;

    const cleanups: Array<() => void> = [];
    const OPEN_CLASS = 'studio-mobile-drawer--open';

    for (const drawer of drawers) {
      const drawerId = drawer.id || drawer.getAttribute('data-studio-mobile-drawer-id') || '';
      const triggerCandidates = Array.from(
        iframeDoc.querySelectorAll<HTMLElement>('[data-studio-mobile-drawer-trigger]')
      );
      const trigger = drawerId
        ? triggerCandidates.find((candidate) =>
          candidate.getAttribute('data-studio-mobile-drawer-target') === drawerId
          || candidate.getAttribute('aria-controls') === drawerId
        ) || null
        : triggerCandidates[0] || null;

      const initial = {
        display: drawer.style.display,
        visibility: drawer.style.visibility,
        opacity: drawer.style.opacity,
        pointerEvents: drawer.style.pointerEvents,
        transform: drawer.style.transform,
        overflow: iframeDoc.body.style.overflow,
      };

      const isOpen = () => drawer.classList.contains(OPEN_CLASS);

      const open = () => {
        drawer.classList.add(OPEN_CLASS);
        drawer.setAttribute('aria-hidden', 'false');
        trigger?.setAttribute('aria-expanded', 'true');
        iframeDoc.body.style.overflow = 'hidden';
        drawer.style.display = 'flex';
        drawer.style.visibility = 'visible';
        drawer.style.opacity = '1';
        drawer.style.pointerEvents = 'auto';
        drawer.style.transform = 'translateY(0px)';
      };

      const close = () => {
        drawer.classList.remove(OPEN_CLASS);
        drawer.setAttribute('aria-hidden', 'true');
        trigger?.setAttribute('aria-expanded', 'false');
        iframeDoc.body.style.overflow = initial.overflow;
        drawer.style.display = initial.display || 'none';
        drawer.style.visibility = initial.visibility || 'hidden';
        drawer.style.opacity = initial.opacity || '0';
        drawer.style.pointerEvents = initial.pointerEvents || 'none';
        drawer.style.transform = initial.transform || 'translateY(-12px)';
      };

      const onTriggerClick = (event: MouseEvent) => {
        event.preventDefault();
        if (isOpen()) {
          close();
        } else {
          open();
        }
      };

      const onCloseClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof iframeWindow.Element)) return;
        if (target.closest('[data-studio-mobile-drawer-close]')) {
          event.preventDefault();
          close();
        }
      };

      const onLinkClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof iframeWindow.Element)) return;
        const link = target.closest('a[href]');
        if (link && drawer.contains(link)) {
          close();
        }
      };

      const onBackdropClick = (event: MouseEvent) => {
        if (isOpen() && event.target === drawer) {
          event.preventDefault();
          close();
        }
      };

      const onKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          close();
          trigger?.focus();
        }
      };

      trigger?.addEventListener('click', onTriggerClick);
      drawer.addEventListener('click', onCloseClick);
      drawer.addEventListener('click', onLinkClick);
      drawer.addEventListener('click', onBackdropClick);
      iframeDoc.addEventListener('keydown', onKeydown);

      cleanups.push(() => {
        trigger?.removeEventListener('click', onTriggerClick);
        drawer.removeEventListener('click', onCloseClick);
        drawer.removeEventListener('click', onLinkClick);
        drawer.removeEventListener('click', onBackdropClick);
        iframeDoc.removeEventListener('keydown', onKeydown);
        close();
      });
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [layers, pageId, editorBreakpoint]);

  return (
    <CanvasPortalProvider value={portalValue}>
      <div
        ref={bodyRef}
        id="canvas-body"
        data-layer-id="body"
        className="contents"
      >
        <LayerRenderer
          layers={childLayers}
          isEditMode={true}
          isPublished={false}
          selectedLayerId={selectedLayerId}
          hoveredLayerId={hoveredLayerId}
          onLayerClick={onLayerClick}
          onLayerUpdate={onLayerUpdate}
          onLayerHover={onLayerHover}
          pageId={pageId}
          pageCollectionItemId={pageCollectionItemId}
          pageCollectionItemData={pageCollectionItemData}
          liveLayerUpdates={liveLayerUpdates}
          liveComponentUpdates={liveComponentUpdates}
          editingComponentVariables={editingComponentVariables}
          editorHiddenLayerIds={editorHiddenLayerIds}
          editorBreakpoint={editorBreakpoint}
          ancestorComponentIds={initialAncestorIds}
        />
      </div>
    </CanvasPortalProvider>
  );
}

/**
 * Canvas Component
 * Uses an embedded iframe with Tailwind Browser CDN for style generation
 */
export default function Canvas({
  layers,
  components,
  selectedLayerId,
  hoveredLayerId,
  breakpoint,
  activeUIState,
  editingComponentId,
  collectionItems,
  collectionFields,
  pageCollectionItem,
  pageCollectionFields,
  assets,
  collectionLayerData,
  pageId,
  onLayerClick,
  onLayerUpdate,
  onDeleteLayer,
  onContentHeightChange,
  onContentWidthChange,
  onGapUpdate,
  onZoomGesture,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomToFit,
  onAutofit,
  onUndo,
  onRedo,
  liveLayerUpdates,
  liveComponentUpdates,
  onIframeReady,
  onLayerHover,
  onCanvasClick,
  editingComponentVariables,
  disableEditorHiddenLayers = false,
  zoom = 100,
  referenceViewportHeight,
}: CanvasProps) {
  // Refs
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<Root | null>(null);
  const mountPointRef = useRef<HTMLDivElement | null>(null);

  // State
  const [iframeReady, setIframeReady] = useState(false);
  const [internalHoveredLayerId, setInternalHoveredLayerId] = useState<string | null>(null);
  const effectiveHoveredLayerId = hoveredLayerId ?? internalHoveredLayerId;

  // Resolve component instances in layers
  const { layers: resolvedLayers, componentMap } = useMemo(() => {
    return serializeLayers(layers, components, editingComponentVariables);
  }, [layers, components, editingComponentVariables]);

  // Enrich page collection item data with reference field dotted keys
  // so variables like "refFieldId.targetFieldId" resolve on canvas
  const enrichedPageCollectionItemData = useMemo(() => {
    const values = pageCollectionItem?.values;
    if (!values || !pageCollectionFields?.length) return values || null;
    return resolveReferenceFieldsSync(
      values,
      pageCollectionFields,
      collectionItems,
      collectionFields
    );
  }, [pageCollectionItem?.values, pageCollectionFields, collectionItems, collectionFields]);

  // Collect layer IDs that should be hidden on canvas (display: hidden with on-load)
  const editorHiddenLayerIds = useMemo(() => {
    if (disableEditorHiddenLayers) return undefined;
    return collectEditorHiddenLayerIds(resolvedLayers);
  }, [resolvedLayers, disableEditorHiddenLayers]);

  // Handle layer click with component resolution
  const handleLayerClick = useCallback((layerId: string, event?: React.MouseEvent) => {
    // Suppress stale left-clicks that fire on the canvas when a context menu
    // item is clicked and the menu dismisses (Radix click-through).
    // Only block when an event is present — onLayerSelect from handleOpenChange
    // passes no event and must always go through to select the right-clicked layer.
    if (event && useEditorStore.getState().isCanvasContextMenuOpen) return;

    const componentRootId = componentMap[layerId];
    const isPartOfComponent = !!componentRootId;
    const isEditingThisComponent = editingComponentId && componentRootId === editingComponentId;

    let targetLayerId = layerId;
    if (isPartOfComponent && !isEditingThisComponent) {
      targetLayerId = componentRootId;
    }

    onLayerClick?.(targetLayerId, event);
  }, [componentMap, editingComponentId, onLayerClick]);

  // Handle hover
  const handleLayerHover = useCallback((layerId: string | null) => {
    // Resolve component root for hover (same logic as click)
    let resolvedLayerId = layerId;
    if (layerId) {
      const componentRootId = componentMap[layerId];
      const isPartOfComponent = !!componentRootId;
      const isEditingThisComponent = editingComponentId && componentRootId === editingComponentId;

      if (isPartOfComponent && !isEditingThisComponent) {
        resolvedLayerId = componentRootId;
      }
    }

    setInternalHoveredLayerId(resolvedLayerId);
    onLayerHover?.(resolvedLayerId);
  }, [componentMap, editingComponentId, onLayerHover]);

  // Initialize iframe with Tailwind Browser CDN (only once)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Guard against re-initialization
    if (rootRef.current) return;

    const initializeIframe = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // Double-check we haven't already initialized
      if (rootRef.current) return;

      // Write the initial HTML with Tailwind Browser CDN (shared template)
      doc.open();
      doc.write(getCanvasIframeHtml('canvas-mount'));
      doc.close();

      // Load minimal Swiper CSS (no layout overrides that conflict with Tailwind)
      loadSwiperCss(doc);

      // Load GSAP for animations in the canvas iframe
      const gsapScript = doc.createElement('script');
      gsapScript.src = 'https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js';
      gsapScript.onload = () => {
        const splitTextScript = doc.createElement('script');
        splitTextScript.src = 'https://cdn.jsdelivr.net/npm/gsap@3/dist/SplitText.min.js';
        splitTextScript.onload = () => {
          const initScript = doc.createElement('script');
          initScript.textContent = `
            if (typeof gsap !== 'undefined' && typeof SplitText !== 'undefined') {
              gsap.registerPlugin(SplitText);
            }
          `;
          doc.head.appendChild(initScript);
        };
        doc.head.appendChild(splitTextScript);
      };
      doc.head.appendChild(gsapScript);

      // Wait for Tailwind to initialize
      setTimeout(() => {
        // Final guard before creating root
        if (rootRef.current) return;

        const mountPoint = doc.getElementById('canvas-mount');
        if (mountPoint) {
          mountPointRef.current = mountPoint as HTMLDivElement;
          rootRef.current = createRoot(mountPoint);
          setIframeReady(true);
        }
      }, 100);
    };

    // Initialize when iframe loads
    iframe.onload = initializeIframe;

    // Trigger initial load if iframe is already ready
    if (iframe.contentDocument?.readyState === 'complete') {
      initializeIframe();
    }

    return () => {
      // Cleanup on unmount - defer to avoid unmounting during React's render phase
      const rootToUnmount = rootRef.current;
      rootRef.current = null;
      mountPointRef.current = null;
      setIframeReady(false);

      // Defer unmount to next frame to ensure we're outside React's render cycle
      if (rootToUnmount) {
        requestAnimationFrame(() => {
          try {
            rootToUnmount.unmount();
          } catch (error) {
            console.warn('Error unmounting canvas root:', error);
          }
        });
      }
    };
  }, []); // Empty deps - only run once on mount

  // Notify parent when iframe is ready
  useEffect(() => {
    if (iframeReady && iframeRef.current && onIframeReady) {
      onIframeReady(iframeRef.current);
    }
  }, [iframeReady, onIframeReady]);

  // Inject font CSS into the canvas iframe when fonts change
  const fontsCss = useFontsStore((state) => state.fontsCss);
  const injectFontsCss = useFontsStore((state) => state.injectFontsCss);

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    injectFontsCss(iframeDoc);
  }, [iframeReady, fontsCss, injectFontsCss]);

  // Inject color variable CSS custom properties into the canvas iframe
  const colorVarCss = useColorVariablesStore((state) => state.generateCssDeclarations());

  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;
    const iframeDoc = iframeRef.current.contentDocument;
    if (!iframeDoc) return;

    const STYLE_ID = 'ycode-color-vars';
    let styleEl = iframeDoc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = STYLE_ID;
      iframeDoc.head.appendChild(styleEl);
    }
    styleEl.textContent = colorVarCss;
  }, [iframeReady, colorVarCss]);

  // Render content into iframe
  useEffect(() => {
    if (!iframeReady || !rootRef.current) return;

    rootRef.current.render(
      <CanvasContent
        layers={resolvedLayers}
        selectedLayerId={selectedLayerId}
        hoveredLayerId={effectiveHoveredLayerId}
        pageId={pageId}
        pageCollectionItemId={pageCollectionItem?.id}
        pageCollectionItemData={enrichedPageCollectionItemData}
        onLayerClick={handleLayerClick}
        onLayerUpdate={onLayerUpdate}
        onLayerHover={handleLayerHover}
        liveLayerUpdates={liveLayerUpdates}
        liveComponentUpdates={liveComponentUpdates}
        editingComponentVariables={editingComponentVariables}
        editingComponentId={editingComponentId}
        editorHiddenLayerIds={editorHiddenLayerIds}
        editorBreakpoint={breakpoint}
        zoom={zoom}
      />
    );
  // selectedLayerId and hoveredLayerId are intentionally excluded from deps:
  // SingleLayerRenderer subscribes to the store directly for selection state,
  // so we don't need to re-render the entire iframe layer tree on selection changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    iframeReady,
    resolvedLayers,
    editingComponentId,
    editingComponentVariables,
    pageId,
    pageCollectionItem?.id,
    enrichedPageCollectionItemData,
    handleLayerClick,
    onLayerUpdate,
    handleLayerHover,
    liveLayerUpdates,
    liveComponentUpdates,
    editorHiddenLayerIds,
    breakpoint,
    zoom,
  ]);

  // Handle keyboard events from iframe
  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused = target.tagName === 'INPUT' ||
                             target.tagName === 'TEXTAREA' ||
                             target.isContentEditable;

      // Delete/Backspace for layer deletion
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId && !isInputFocused) {
        e.preventDefault();
        onDeleteLayer?.();
        return;
      }

      // Undo/Redo shortcuts (Cmd/Ctrl + Z / Shift + Z, or Cmd/Ctrl + Y)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isInputFocused) {
        e.preventDefault();
        if (e.shiftKey) {
          // Redo: Cmd/Ctrl + Shift + Z
          onRedo?.();
        } else {
          // Undo: Cmd/Ctrl + Z
          onUndo?.();
        }
        return;
      }

      // Redo alternative: Cmd/Ctrl + Y
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !isInputFocused) {
        e.preventDefault();
        onRedo?.();
        return;
      }

      // Zoom shortcuts (Cmd/Ctrl + key)
      if (e.metaKey || e.ctrlKey) {
        // Cmd+0 - Reset zoom
        if (e.key === '0' && onResetZoom) {
          e.preventDefault();
          onResetZoom();
          return;
        }

        // Cmd++ or Cmd+= - Zoom in
        if ((e.key === '+' || e.key === '=') && onZoomIn) {
          e.preventDefault();
          onZoomIn();
          return;
        }

        // Cmd+- - Zoom out
        if (e.key === '-' && onZoomOut) {
          e.preventDefault();
          onZoomOut();
          return;
        }

        // Cmd+1 - Fit height
        if (e.key === '1' && onZoomToFit) {
          e.preventDefault();
          onZoomToFit();
          return;
        }

        // Cmd+2 - Fit width
        if (e.key === '2' && onAutofit) {
          e.preventDefault();
          onAutofit();
          return;
        }
      }

      // Forward keyboard events to parent window for global shortcuts
      // (copy, paste, undo, redo, copy style, paste style, etc.)
      if (!isInputFocused) {
        const syntheticEvent = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(syntheticEvent);
      }
    };

    doc.addEventListener('keydown', handleKeyDown);
    return () => doc.removeEventListener('keydown', handleKeyDown);
  }, [iframeReady, selectedLayerId, onDeleteLayer, onResetZoom, onZoomIn, onZoomOut, onZoomToFit, onAutofit, onUndo, onRedo]);

  // Handle any click inside the iframe (capture phase to run before stopPropagation)
  useEffect(() => {
    if (!iframeReady || !iframeRef.current) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleClick = () => {
      onCanvasClick?.();
    };

    // Use capture phase to ensure we catch clicks before stopPropagation
    doc.addEventListener('click', handleClick, true);
    return () => doc.removeEventListener('click', handleClick, true);
  }, [iframeReady, onCanvasClick]);

  // Content size reporting (height always, width when callback provided)
  // Uses a stabilization delay for height decreases to prevent transient
  // drops (e.g. iframe reloads inside the canvas) from causing scroll jumps.
  const lastReportedHeightRef = useRef(0);

  useEffect(() => {
    if (!iframeReady || !iframeRef.current || !onContentHeightChange) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    // Reset so the first measurement after a breakpoint switch reports immediately
    // instead of being delayed by the shrink timer
    lastReportedHeightRef.current = 0;

    let shrinkTimer: ReturnType<typeof setTimeout> | undefined;

    const reportHeight = (height: number) => {
      clearTimeout(shrinkTimer);
      const clamped = Math.max(height, 100);

      if (clamped >= lastReportedHeightRef.current) {
        lastReportedHeightRef.current = clamped;
        onContentHeightChange(clamped);
      } else {
        // Delay height decreases so transient dips don't cause scroll jumps
        shrinkTimer = setTimeout(() => {
          lastReportedHeightRef.current = clamped;
          onContentHeightChange(clamped);
        }, 150);
      }
    };

    const measureContent = () => {
      const body = doc.body;
      if (!body) return;

      // Component editing mode: measure bounding box of all visible layers
      // including absolutely positioned elements that extend beyond in-flow content
      if (onContentWidthChange) {
        const canvasBody = doc.getElementById('canvas-body');
        if (canvasBody && canvasBody.children.length > 0) {
          const bodyRect = body.getBoundingClientRect();
          let maxChildWidth = 0;
          let maxChildBottom = 0;

          const allLayers = canvasBody.querySelectorAll('[data-layer-id]');
          allLayers.forEach(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            maxChildWidth = Math.max(maxChildWidth, rect.right - bodyRect.left);
            maxChildBottom = Math.max(maxChildBottom, rect.bottom - bodyRect.top);
          });

          onContentWidthChange(maxChildWidth);
          reportHeight(maxChildBottom);
          return;
        }
      }

      // Override viewport-height units (vh, svh, dvh, lvh) with fixed pixel
      // values so layers using these units don't grow with the iframe height.
      if (referenceViewportHeight && referenceViewportHeight > 0) {
        updateViewportOverrides(doc, referenceViewportHeight);
      }

      // Page mode: use content extent (actual child bounds) rather than
      // scrollHeight, which inflates when body h-full fills the iframe.
      const extent = measureContentExtent(doc);
      if (extent > 0) {
        reportHeight(extent);
      }
    };

    // Measure after render — multiple passes to handle Tailwind CDN race.
    // Tailwind Browser CDN processes classes asynchronously via CSSOM APIs
    // (not DOM mutations), so the MutationObserver alone can't detect when
    // styles are applied. measureContentExtent is immune to iframe inflation,
    // so later passes safely converge to the correct value.
    const timeoutId = setTimeout(measureContent, 100);
    const lateTimeoutId = setTimeout(measureContent, 500);

    // Debounce observer to avoid measuring during transient DOM states
    let observerTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        requestAnimationFrame(measureContent);
      }, 80);
    });

    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Also watch <head> for Tailwind CDN style injections that change layout
    // Without this, the initial measurement fires before CSS is applied,
    // and no body mutation triggers a re-measure after styles settle.
    if (doc.head) {
      observer.observe(doc.head, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(lateTimeoutId);
      clearTimeout(shrinkTimer);
      clearTimeout(observerTimer);
      observer.disconnect();
    };
  }, [iframeReady, onContentHeightChange, onContentWidthChange, resolvedLayers, referenceViewportHeight, breakpoint]);

  // Handle zoom gestures from iframe (Ctrl+wheel, trackpad pinch)
  useEffect(() => {
    if (!iframeReady || !iframeRef.current || !onZoomGesture) return;

    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();

        // Positive deltaY means zoom out, negative means zoom in
        const delta = -e.deltaY;
        onZoomGesture(delta);

        return false;
      }
    };

    doc.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      doc.removeEventListener('wheel', handleWheel);
    };
  }, [iframeReady, onZoomGesture]);

  return (
    <iframe
      ref={iframeRef}
      className={cn(
        'w-full h-full border-0',
        editingComponentId ? 'bg-transparent' : 'bg-white'
      )}
      title="Canvas Editor"
      tabIndex={-1}
    />
  );
}
