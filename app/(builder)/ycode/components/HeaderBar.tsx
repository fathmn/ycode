'use client';

import {
  STUDIO_PROJECT_SELECTION_EVENT,
  getSelectedStudioProjectSlug,
  studioProjectsApi,
} from '@/lib/api';
import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useEditorUrl } from '@/hooks/use-editor-url';
import { findHomepage } from '@/lib/page-utils';
import { getTranslationValue } from '@/lib/localisation-utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// 4. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import { buildSlugPath, buildDynamicPageUrl, buildLocalizedSlugPath, buildLocalizedDynamicPageUrl } from '@/lib/page-utils';
import { isNovumOperatorRole } from '@/lib/settings-nav-items';
import { studioProjectRoutePathFromSlug } from '@/lib/studio-project-path';

// 5. Types
import type { Page } from '@/types';
import type { User } from '@supabase/supabase-js';
import ActiveUsersInHeader from './ActiveUsersInHeader';
import InviteUserButton from './InviteUserButton';
import StudioProjectSelector from './StudioProjectSelector';
import PublishPopover from './PublishPopover';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { BackupRestoreDialog } from '@/components/project/BackupRestoreDialog';
import { isCloudVersion } from '@/lib/utils';
import { toast } from 'sonner';

type StudioProject = {
  slug: string;
  studio_path_slug: string | null;
  primary_domain: string | null;
  production_url: string | null;
  role: string;
};

function publicBaseUrlForProject(project: StudioProject | null, fallbackBaseUrl: string): string {
  const productionUrl = project?.production_url?.trim();
  if (!productionUrl) return fallbackBaseUrl;
  if (/^https?:\/\//i.test(productionUrl)) return productionUrl.replace(/\/+$/, '');
  return `https://${productionUrl.replace(/\/+$/, '')}`;
}

interface HeaderBarProps {
  user: User | null;
  signOut: () => Promise<void>;
  showPageDropdown: boolean;
  setShowPageDropdown: (show: boolean) => void;
  currentPage: Page | undefined;
  currentPageId: string | null;
  pages: Page[];
  setCurrentPageId: (id: string) => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: Date | null;
  isPublishing: boolean;
  setIsPublishing: (isPublishing: boolean) => void;
  saveImmediately: (pageId: string) => Promise<void>;
  activeTab: 'pages' | 'layers' | 'cms';
  onExitComponentEditMode?: () => void;
  onPublishSuccess: () => void;
  isSettingsRoute?: boolean;
}

export default function HeaderBar({
  user,
  signOut,
  showPageDropdown,
  setShowPageDropdown,
  currentPage,
  currentPageId,
  pages,
  setCurrentPageId,
  isSaving,
  hasUnsavedChanges,
  lastSaved,
  isPublishing,
  setIsPublishing,
  saveImmediately,
  activeTab,
  onExitComponentEditMode,
  onPublishSuccess,
  isSettingsRoute = false,
}: HeaderBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const pageDropdownRef = useRef<HTMLDivElement>(null);
  const { currentPageCollectionItemId, currentPageId: storeCurrentPageId, isPreviewMode, setPreviewMode, openFileManager, setKeyboardShortcutsOpen, setActiveSidebarTab, lastDesignUrl, setLastDesignUrl, previewReturnUrl, previewReturnTab, setPreviewReturn } = useEditorStore();
  const { folders, pages: storePages } = usePagesStore();
  const { items, fields, collections, selectedCollectionId: storeSelectedCollectionId, setSelectedCollectionId } = useCollectionsStore();
  const { locales, selectedLocaleId, setSelectedLocaleId, translations } = useLocalisationStore();
  const { navigateToLayers, navigateToCollection, navigateToCollections, updateQueryParams, routeType } = useEditorUrl();

  // Optimistic nav button state - set immediately on click, cleared when URL catches up
  type NavButton = 'design' | 'cms' | 'forms';
  const [optimisticNav, setOptimisticNav] = useState<NavButton | null>(null);
  const [isEnteringPreview, setIsEnteringPreview] = useState(false);

  // Clear optimistic state once the URL reflects the clicked route
  useEffect(() => {
    if (!optimisticNav) return;
    const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
    const isCmsRoute = routeType === 'collection' || routeType === 'collections-base';
    const isFormsRoute = routeType === 'forms';

    if (
      (optimisticNav === 'design' && isDesignRoute) ||
      (optimisticNav === 'cms' && isCmsRoute) ||
      (optimisticNav === 'forms' && isFormsRoute)
    ) {
      setOptimisticNav(null);
    }
  }, [routeType, optimisticNav]);

  // Turn off preview mode only after navigation to the return route completes,
  // keeping the preview overlay visible during the transition to avoid flashing
  useEffect(() => {
    if (!isPreviewMode || previewReturnUrl) return;
    const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
    if (!isDesignRoute) {
      setPreviewMode(false);
    }
  }, [routeType, isPreviewMode, previewReturnUrl, setPreviewMode]);

  // Derive active button: optimistic state takes priority, then URL
  const activeNavButton = useMemo((): NavButton | null => {
    if (optimisticNav) return optimisticNav;
    if (routeType === 'collection' || routeType === 'collections-base') return 'cms';
    if (routeType === 'forms') return 'forms';
    if (routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null) return 'design';
    return null;
  }, [optimisticNav, routeType]);

  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') as 'system' | 'light' | 'dark' | null;
      return savedTheme || 'dark';
    }
    return 'dark';
  });
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [selectedProjectBaseUrl, setSelectedProjectBaseUrl] = useState<string>('');
  const [selectedProjectPathSlug, setSelectedProjectPathSlug] = useState<string | null>(null);
  const [selectedProjectRole, setSelectedProjectRole] = useState<string | null>(null);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const isNovumOperator = isNovumOperatorRole(selectedProjectRole);
  const studioRoute = useCallback((routePath: string) => (
    studioProjectRoutePathFromSlug(selectedProjectPathSlug, routePath)
  ), [selectedProjectPathSlug]);

  // Get current host after mount
  useEffect(() => {
    setBaseUrl(window.location.protocol + '//' + window.location.host);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const resolveProjectBaseUrl = async () => {
      const fallbackBaseUrl = window.location.protocol + '//' + window.location.host;
      try {
        const selectedSlug = getSelectedStudioProjectSlug();
        const response = await studioProjectsApi.getAssigned();
        const projects = (response.data || []) as StudioProject[];
        const selectedProject = selectedSlug
          ? projects.find((project) => project.slug === selectedSlug) || null
          : projects[0] || null;

        if (isMounted) {
          setSelectedProjectBaseUrl(publicBaseUrlForProject(selectedProject, fallbackBaseUrl));
          setSelectedProjectPathSlug(selectedProject?.studio_path_slug || null);
          setSelectedProjectRole(selectedProject?.role || null);
        }
      } catch (error) {
        console.error('Failed to resolve selected project base URL:', error);
        if (isMounted) setSelectedProjectBaseUrl(fallbackBaseUrl);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'studio:selected-project-slug' || event.key === 'novum:selected-project-slug') {
        resolveProjectBaseUrl();
      }
    };

    resolveProjectBaseUrl();
    window.addEventListener(STUDIO_PROJECT_SELECTION_EVENT, resolveProjectBaseUrl);
    window.addEventListener('storage', handleStorage);
    return () => {
      isMounted = false;
      window.removeEventListener(STUDIO_PROJECT_SELECTION_EVENT, resolveProjectBaseUrl);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // Get selected locale (computed from subscribed store values)
  const selectedLocale = useMemo(() => {
    if (!selectedLocaleId) return null;
    return locales.find(l => l.id === selectedLocaleId) || null;
  }, [selectedLocaleId, locales]);

  // Get translations for the selected locale
  const localeTranslations = useMemo(() => {
    return selectedLocaleId ? translations[selectedLocaleId] : undefined;
  }, [selectedLocaleId, translations]);

  // Build full page path including folders (memoized for performance)
  const fullPagePath = useMemo(() => {
    if (!currentPage) return '/';
    return buildSlugPath(currentPage, folders, 'page');
  }, [currentPage, folders]);

  // Build localized page path with translated slugs
  const localizedPagePath = useMemo(() => {
    // If no current page, use homepage for localization route
    const pageToUse = currentPage || (isSettingsRoute ? findHomepage(storePages) : null);

    if (!pageToUse) return '/';

    return buildLocalizedSlugPath(
      pageToUse,
      folders,
      'page',
      selectedLocale,
      localeTranslations
    );
  }, [currentPage, isSettingsRoute, storePages, folders, selectedLocale, localeTranslations]);

  // Get collection item slug value for dynamic pages (with translation support)
  const collectionItemSlug = useMemo(() => {
    if (!currentPage?.is_dynamic || !currentPageCollectionItemId) {
      return null;
    }

    const collectionId = currentPage.settings?.cms?.collection_id;
    const slugFieldId = currentPage.settings?.cms?.slug_field_id;

    if (!collectionId || !slugFieldId) {
      return null;
    }

    // Find the item in the store
    const collectionItems = items[collectionId] || [];
    const selectedItem = collectionItems.find(item => item.id === currentPageCollectionItemId);

    if (!selectedItem || !selectedItem.values) {
      return null;
    }

    // Get the slug value from the item's values
    let slugValue = selectedItem.values[slugFieldId];

    // If locale is selected, check for translated slug
    if (localeTranslations && slugValue) {
      const collectionFields = fields[collectionId] || [];
      const slugField = collectionFields.find((f: { id: string; key: string | null }) => f.id === slugFieldId);

      if (slugField) {
        // Build translation key: field:key:{key} or field:id:{id}
        const contentKey = slugField.key
          ? `field:key:${slugField.key}`
          : `field:id:${slugField.id}`;
        const translationKey = `cms:${currentPageCollectionItemId}:${contentKey}`;
        const translation = localeTranslations[translationKey];

        const translatedSlug = getTranslationValue(translation);
        if (translatedSlug) {
          slugValue = translatedSlug;
        }
      }
    }

    return slugValue || null;
  }, [currentPage, currentPageCollectionItemId, items, fields, localeTranslations]);

  // Build preview URL (special handling for error pages and dynamic pages)
  const previewUrl = useMemo(() => {
    if (!currentPage) return '';

    // Error pages use special preview route
    if (currentPage.error_page !== null) {
      return `/ycode/preview/error-pages/${currentPage.error_page}`;
    }

    // For dynamic pages, use localized dynamic URL builder
    const path = currentPage.is_dynamic
      ? buildLocalizedDynamicPageUrl(currentPage, folders, collectionItemSlug, selectedLocale, localeTranslations)
      : localizedPagePath;

    return `/ycode/preview${path === '/' ? '' : path}`;
  }, [currentPage, folders, localizedPagePath, collectionItemSlug, selectedLocale, localeTranslations]);

  // Build published URL (for the link in the center)
  const publishedUrl = useMemo(() => {
    // If no current page, use homepage for localization route
    const pageToUse = currentPage || (isSettingsRoute ? findHomepage(storePages) : null);
    if (!pageToUse) return '';

    // For dynamic pages, use localized dynamic URL builder
    const path = pageToUse.is_dynamic
      ? buildLocalizedDynamicPageUrl(pageToUse, folders, collectionItemSlug, selectedLocale, localeTranslations)
      : localizedPagePath;

    return path === '/' ? '' : path;
  }, [currentPage, isSettingsRoute, storePages, folders, localizedPagePath, collectionItemSlug, selectedLocale, localeTranslations]);

  // Apply theme to HTML element
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemPrefersDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    } else if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  // Close page dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pageDropdownRef.current && !pageDropdownRef.current.contains(event.target as Node)) {
        setShowPageDropdown(false);
      }
    };

    if (showPageDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPageDropdown, setShowPageDropdown]);

  return (
    <>
    <header className="h-14 bg-background border-b grid grid-cols-3 items-center px-4">
      {/* Left: Logo & Navigation */}
      <div className="flex items-center gap-2">

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary" size="sm"
              className="size-8!"
              aria-label="studio.novum partners Menu"
              title="studio.novum partners"
            >
              <span className="text-[11px] font-semibold tracking-normal">np</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {isCloudVersion() && (
              <>
                <DropdownMenuItem asChild>
                  <a href="https://dashboard.ycode.cloud/dashboard">
                    Dashboard
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              onClick={() => router.push(studioRoute('/settings/general'))}
            >
              Einstellungen
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => openFileManager()}
            >
              Dateien
            </DropdownMenuItem>

            {isNovumOperator && (
              <>
                <DropdownMenuItem
                  onClick={() => router.push('/ycode/integrations/apps')}
                >
                  Integrationen
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => setShowTransferDialog(true)}
                >
                  Backup &amp; Restore
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Darstellung
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as 'system' | 'light' | 'dark')}>
                  <DropdownMenuRadioItem value="system">
                    System
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    Hell
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    Dunkel
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onClick={() => setKeyboardShortcutsOpen(true)}
            >
              Tastaturkürzel
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => router.push('/ycode/profile')}
            >
              Mein Profil
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={async () => {
                await signOut();
              }}
            >
              Abmelden
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex gap-1">
          <Button
            variant={activeNavButton === 'design' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              setOptimisticNav('design');
              setActiveSidebarTab('layers');
              // Restore last design URL if available
              if (lastDesignUrl) {
                router.push(lastDesignUrl);
              } else {
                const targetPageId = storeCurrentPageId || findHomepage(storePages)?.id || storePages[0]?.id;
                if (targetPageId) {
                  navigateToLayers(targetPageId);
                }
              }
            }}
          >
            <Icon name="cursor-default" />
            Design
          </Button>
          <Button
            variant={activeNavButton === 'cms' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              // Save current design URL before navigating away
              const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component';
              if (isDesignRoute) {
                setLastDesignUrl(window.location.pathname + window.location.search);
              }
              setOptimisticNav('cms');
              setActiveSidebarTab('cms');
              // Navigate to last selected or first available collection
              const targetCollectionId = storeSelectedCollectionId || collections[0]?.id;
              if (targetCollectionId) {
                setSelectedCollectionId(targetCollectionId);
                navigateToCollection(targetCollectionId);
              } else {
                navigateToCollections();
              }
            }}
          >
            <Icon name="database" />
            CMS
          </Button>
          <Button
            variant={activeNavButton === 'forms' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              // Save current design URL before navigating away
              const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component';
              if (isDesignRoute) {
                setLastDesignUrl(window.location.pathname + window.location.search);
              }
              setOptimisticNav('forms');
              router.push(studioRoute('/forms'));
            }}
          >
            <Icon name="form" />
            Formulare
          </Button>
        </div>
      </div>

      <div className="flex gap-1.5 items-center justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost">
              <Icon name="globe" />
              {selectedLocale ? selectedLocale.code.toUpperCase() : 'DE'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={selectedLocaleId || ''}
              onValueChange={(value) => setSelectedLocaleId(value)}
            >
              {locales.map((locale) => (
                <DropdownMenuRadioItem key={locale.id} value={locale.id}>
                  <span className="flex items-center gap-3">
                    {locale.label}
                    {locale.is_default && (
                      <Badge variant="secondary" className="text-[10px] mr-5">
                        Default
                      </Badge>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {!pathname?.startsWith('/ycode/localization') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => router.push('/ycode/localization')}
                >
                  Sprachen verwalten
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="h-5">
          <Separator orientation="vertical" />
        </div>

        <Button
          size="xs"
          variant="ghost"
          asChild
        >
          <a
            href={(selectedProjectBaseUrl || baseUrl) + publishedUrl} target="_blank"
            rel="noopener noreferrer"
          >
            {selectedProjectBaseUrl || baseUrl}
          </a>
        </Button>

      </div>

      {/* Right: User & Actions */}
      <div className="flex items-center justify-end gap-2">
        <StudioProjectSelector />

        {/* Active Users */}
        <ActiveUsersInHeader />

        {/* Invite User */}
        <InviteUserButton />

        {/* Save Status Indicator */}
        <div className="flex items-center justify-end w-16 text-xs text-zinc-500 dark:text-white/50">
          {isSaving ? (
            <>
              <span>Speichert</span>
            </>
          ) : hasUnsavedChanges ? (
            <>
              <span>Offen</span>
            </>
          ) : lastSaved ? (
            <>
              <span>Gespeichert</span>
            </>
          ) : (
            <>
              <span>Bereit</span>
            </>
          )}
        </div>

        {/* Preview button */}
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            if (isPreviewMode) {
              if (previewReturnUrl) {
                // Navigate back while keeping preview visible — the useEffect
                // above will turn off preview once the route change completes
                if (previewReturnTab) {
                  setActiveSidebarTab(previewReturnTab);
                }
                router.push(previewReturnUrl);
                setPreviewReturn(null);
                return;
              }

              setPreviewMode(false);
              updateQueryParams({ preview: undefined });
              return;
            }

            if (currentPageId) {
              setIsEnteringPreview(true);
              try {
                await saveImmediately(currentPageId);
              } catch (error) {
                console.error('Failed to save before preview:', error);
                toast.error('Vorschau konnte nicht geöffnet werden', {
                  description: 'Der aktuelle Entwurf konnte nicht gespeichert werden.',
                });
                return;
              } finally {
                setIsEnteringPreview(false);
              }
            }

            setPreviewMode(true);

            // Preview renders the current page, so when invoked from a non-design
            // route (CMS, forms, etc.) we need to jump to the layers view first
            const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
            if (!isDesignRoute && currentPageId) {
              setPreviewReturn(window.location.pathname + window.location.search, activeTab);
              setActiveSidebarTab('layers');
              const params = new URLSearchParams(window.location.search);
              params.set('preview', 'true');
              router.push(`/ycode/layers/${currentPageId}?${params.toString()}`);
              return;
            }

            updateQueryParams({ preview: 'true' });
          }}
          disabled={!currentPage || isSaving || isEnteringPreview}
          className={isPreviewMode ? 'bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90' : ''}
        >
          <Icon name="preview" />
        </Button>

        <PublishPopover
          isPublishing={isPublishing}
          setIsPublishing={setIsPublishing}
          baseUrl={selectedProjectBaseUrl || baseUrl}
          publishedUrl={publishedUrl}
          onPublishSuccess={onPublishSuccess}
        />

      </div>
    </header>

    <BackupRestoreDialog
      open={showTransferDialog}
      onOpenChange={setShowTransferDialog}
    />
    </>
  );
}
