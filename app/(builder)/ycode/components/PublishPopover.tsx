'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import Icon from '@/components/ui/icon';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { STUDIO_PROJECT_SELECTION_EVENT, getSelectedStudioProjectSlug, publishApi } from '@/lib/api';
import { STUDIO_BASE_PATH } from '@/lib/brand';
import { isPreviewPathname } from '@/lib/studio-project-path';
import { formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';

interface PublishPreviewCounts {
  pages: number;
  collections: number;
  collectionItems: number;
  components: number;
  layerStyles: number;
  assets: number;
  translations: number;
  total: number;
}

interface PublishReadiness {
  livePublishAvailable: boolean;
  projectScopedPublishAvailable: boolean;
  previewApproved?: boolean;
  blockerMessage: string | null;
}

/** Breakdown row config for rendering */
const BREAKDOWN_ITEMS: { key: keyof Omit<PublishPreviewCounts, 'total'>; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'pages', label: 'Seiten', icon: 'page' },
  { key: 'components', label: 'Komponenten', icon: 'component' },
  { key: 'collections', label: 'CMS-Collections', icon: 'database' },
  { key: 'collectionItems', label: 'CMS-Einträge', icon: 'database' },
  { key: 'layerStyles', label: 'Layer-Styles', icon: 'cube' },
  { key: 'assets', label: 'Assets', icon: 'image' },
  { key: 'translations', label: 'Translations', icon: 'globe' },
];

function getLastRenderedPreviewUrl(): string {
  if (typeof window === 'undefined') return `${STUDIO_BASE_PATH}/preview`;
  const projectSlug = getSelectedStudioProjectSlug();
  const value = window.localStorage?.getItem('studio:last-rendered-preview-url') || '';
  try {
    const url = new URL(value, window.location.origin);
    if (isPreviewPathname(url.pathname)) {
      if (projectSlug && url.searchParams.get('project') !== projectSlug) {
        return getProjectPreviewUrl();
      }
      return `${url.pathname}${url.search}`;
    }
  } catch {
    // Fall through to the selected-project preview URL.
  }
  return getProjectPreviewUrl();
}

function getProjectPreviewUrl(): string {
  const projectSlug = getSelectedStudioProjectSlug();
  if (!projectSlug) return `${STUDIO_BASE_PATH}/preview`;
  const params = new URLSearchParams({ project: projectSlug });
  return `${STUDIO_BASE_PATH}/preview?${params.toString()}`;
}

function displayUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, typeof window === 'undefined' ? 'https://studio.novum-partners.de' : window.location.origin);
    return url.host + url.pathname.replace(/\/$/, '') + url.search;
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function absoluteUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return path || '/';
  try {
    return new URL(path || '/', normalizedBaseUrl).toString();
  } catch {
    return `${normalizedBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

function isRenderedPreviewForSelectedProject(value: string | null): boolean {
  if (typeof window === 'undefined' || !value) return false;
  try {
    const url = new URL(value, window.location.origin);
    if (!isPreviewPathname(url.pathname)) {
      return false;
    }
    const projectSlug = getSelectedStudioProjectSlug();
    return !projectSlug || url.searchParams.get('project') === projectSlug;
  } catch {
    return false;
  }
}

interface PublishPopoverProps {
  isPublishing: boolean;
  setIsPublishing: (isPublishing: boolean) => void;
  baseUrl: string;
  primaryDomain?: string | null;
  publishedUrl: string;
  isDisabled?: boolean;
  onPublishSuccess: () => void;
}

export default function PublishPopover({
  isPublishing,
  setIsPublishing,
  baseUrl,
  primaryDomain,
  publishedUrl,
  isDisabled = false,
  onPublishSuccess,
}: PublishPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [changeCounts, setChangeCounts] = useState<PublishPreviewCounts | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isRevertDialogOpen, setIsRevertDialogOpen] = useState(false);
  const [isApprovingPreview, setIsApprovingPreview] = useState(false);
  const [previewApprovedAt, setPreviewApprovedAt] = useState<string | null>(null);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null);
  const [selectedProjectSlug, setSelectedProjectSlug] = useState<string | null>(() => getSelectedStudioProjectSlug());
  const [lastRenderedPreviewUrl, setLastRenderedPreviewUrl] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : window.localStorage?.getItem('studio:last-rendered-preview-url')
  ));

  const { getSettingByKey, updateSetting } = useSettingsStore();
  const publishedAt = getSettingByKey('published_at');
  const requiresProjectSelection = !selectedProjectSlug;
  const livePublishBlocked = publishReadiness?.livePublishAvailable !== true;
  const livePublishBlockerMessage = publishReadiness?.blockerMessage
    || 'Live-Schaltung ist blockiert, bis projektgebundenes Publishing verfügbar ist.';
  const previewApproved = publishReadiness?.previewApproved === true;
  const hasRenderedPreviewForSelectedProject = isRenderedPreviewForSelectedProject(lastRenderedPreviewUrl);
  const liveUrl = absoluteUrl(baseUrl, publishedUrl);
  const primaryDomainUrl = primaryDomain ? absoluteUrl(primaryDomain, publishedUrl) : null;
  const showPrimaryDomain = Boolean(primaryDomainUrl && displayUrl(primaryDomainUrl) !== displayUrl(liveUrl));
  const previewDisplayUrl = displayUrl(getProjectPreviewUrl());

  const loadChangesCount = useCallback(async (readinessOverride: PublishReadiness | null) => {
    setIsLoadingCount(true);
    try {
      if (readinessOverride?.projectScopedPublishAvailable !== true) {
        setChangeCounts(null);
        return;
      }
      const response = await publishApi.getPreview();
      setChangeCounts(response.data ?? null);
    } catch (error) {
      console.error('Failed to load changes count:', error);
      setChangeCounts(null);
    } finally {
      setIsLoadingCount(false);
    }
  }, []);

  const loadPublishReadiness = useCallback(async (): Promise<PublishReadiness | null> => {
    const response = await publishApi.getReadiness();
    if (response.data) {
      setPublishReadiness(response.data);
      if (response.data.previewApproved !== true) {
        setPreviewApprovedAt(null);
      }
      if (!response.data.projectScopedPublishAvailable) {
        setChangeCounts(null);
      } else {
        loadChangesCount(response.data);
      }
      return response.data;
    } else {
      setPublishReadiness({
        livePublishAvailable: false,
        projectScopedPublishAvailable: false,
        blockerMessage: response.error || 'Publish-Bereitschaft konnte nicht geprüft werden',
      });
      setChangeCounts(null);
      setPreviewApprovedAt(null);
      return null;
    }
  }, [loadChangesCount]);

  // Load changes count when popover opens
  useEffect(() => {
    if (isOpen) {
      loadPublishReadiness();
    }
  }, [isOpen, loadPublishReadiness]);

  useEffect(() => {
    const updateSelectedProject = () => setSelectedProjectSlug(getSelectedStudioProjectSlug());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'studio:selected-project-slug' || event.key === 'studio:selected-project-slug') {
        updateSelectedProject();
      }
      if (event.key === 'studio:last-rendered-preview-url') {
        setLastRenderedPreviewUrl(event.newValue);
        if (isOpen) loadPublishReadiness();
      }
    };
    const handlePreviewRendered = () => {
      setLastRenderedPreviewUrl(window.localStorage?.getItem('studio:last-rendered-preview-url'));
      if (isOpen) loadPublishReadiness();
    };
    const handlePreviewRenderFailed = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      toast.error(reason
        ? `Vorschau konnte nicht bestätigt werden: ${reason}`
        : 'Vorschau konnte nicht bestätigt werden');
    };
    const handleVisible = () => {
      if (document.visibilityState === 'visible' && isOpen) {
        setLastRenderedPreviewUrl(window.localStorage?.getItem('studio:last-rendered-preview-url'));
        loadPublishReadiness();
      }
    };
    window.addEventListener(STUDIO_PROJECT_SELECTION_EVENT, updateSelectedProject);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('studio:preview-rendered', handlePreviewRendered);
    window.addEventListener('studio:preview-render-failed', handlePreviewRenderFailed);
    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleVisible);
    updateSelectedProject();
    return () => {
      window.removeEventListener(STUDIO_PROJECT_SELECTION_EVENT, updateSelectedProject);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('studio:preview-rendered', handlePreviewRendered);
      window.removeEventListener('studio:preview-render-failed', handlePreviewRenderFailed);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleVisible);
    };
  }, [isOpen, loadPublishReadiness]);

  useEffect(() => {
    setPreviewApprovedAt(null);
    setPublishSuccess(false);
    setPublishReadiness(null);
    setChangeCounts(null);
    if (isOpen && selectedProjectSlug) {
      setLastRenderedPreviewUrl(window.localStorage?.getItem('studio:last-rendered-preview-url'));
      loadPublishReadiness();
      loadChangesCount(null);
    }
  }, [selectedProjectSlug, isOpen, loadPublishReadiness, loadChangesCount]);

  const handlePublishAll = useCallback(async () => {
    try {
      setIsPublishing(true);
      toast.loading('Live-Update wird verarbeitet...', { id: 'publish-live-update' });

      const result = await publishApi.publish({ publishAll: true });

      if (result.error) {
        throw new Error(result.error);
      }

      // Sync published timestamp to store from response
      if (result.data?.published_at_setting?.value) {
        updateSetting('published_at', result.data.published_at_setting.value);
      }

      if (result.data?.deployment && !result.data.deployment.triggered) {
        toast.dismiss('publish-live-update');
        toast.warning('Website wurde gespeichert, aber das Vercel Deployment wurde nicht gestartet');
      } else {
        toast.dismiss('publish-live-update');
        toast.success(
          result.data?.deployment?.triggered
            ? 'Website wurde live geschaltet und Deployment gestartet'
            : 'Website wurde live geschaltet',
          {
            action: {
              label: 'Öffnen',
              onClick: () => window.open(liveUrl, '_blank'),
            },
          }
        );
      }

      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000);

      // Refresh counts in background (non-blocking)
      onPublishSuccess();
      loadPublishReadiness();
    } catch (error) {
      console.error('Failed to publish all:', error);
      toast.dismiss('publish-live-update');
      toast.error(error instanceof Error ? error.message : 'Live-Update konnte nicht gestartet werden');
    } finally {
      setIsPublishing(false);
    }
  }, [liveUrl, loadPublishReadiness, onPublishSuccess, setIsPublishing, updateSetting]);

  const handleApprovePreview = useCallback(async () => {
    try {
      setIsApprovingPreview(true);

      const result = await publishApi.approvePreview(getLastRenderedPreviewUrl());

      if (result.error) {
        throw new Error(result.error);
      }

      const readiness = await loadPublishReadiness();
      if (readiness?.previewApproved === true) {
        setPreviewApprovedAt(result.data?.created_at || new Date().toISOString());
        toast.success('Vorschau für Live-Schaltung freigegeben');
      } else {
        setPreviewApprovedAt(null);
        toast.error(readiness?.blockerMessage || 'Vorschau konnte nicht für den aktuellen Entwurf freigegeben werden');
      }
    } catch (error) {
      console.error('Failed to approve preview:', error);
      setPreviewApprovedAt(null);
      await loadPublishReadiness();
      toast.error(error instanceof Error ? error.message : 'Vorschau konnte nicht freigegeben werden');
    } finally {
      setIsApprovingPreview(false);
    }
  }, [loadPublishReadiness]);

  const handleRevertConfirm = useCallback(async () => {
    try {
      setIsReverting(true);

      const result = await publishApi.revert();

      if (result.error) {
        throw new Error(result.error);
      }

      toast.success('Rollback erfolgreich, Studio wird neu geladen...');

      // Full reload to refresh all editor stores with reverted data
      window.location.reload();
    } catch (error) {
      console.error('Failed to revert:', error);
      toast.error('Rollback konnte nicht ausgeführt werden');
      setIsReverting(false);
      setIsRevertDialogOpen(false);
    }
  }, []);

  return (
    <>
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" disabled={isDisabled || requiresProjectSelection}>Live schalten</Button>
      </PopoverTrigger>

      <PopoverContent className="mr-4 mt-0.5 w-72">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Live-Domain</span>
          <Label className="break-all leading-tight">
            <a
              href={liveUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {displayUrl(liveUrl)}
            </a>
          </Label>
          <span className="text-popover-foreground text-[10px]">
            {publishedAt ? `Live ${formatRelativeTime(publishedAt, false)}` : 'Noch nicht live geschaltet'}
          </span>
        </div>

        {showPrimaryDomain && primaryDomainUrl && (
          <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Kundendomain</span>
            <a
              href={primaryDomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-xs text-popover-foreground hover:underline"
            >
              {displayUrl(primaryDomainUrl)}
            </a>
          </div>
        )}

        <hr className="my-3" />

        <div className="flex flex-col gap-2">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Vorschau</span>
            <span className="block break-all text-xs text-popover-foreground">{previewDisplayUrl}</span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => {
              // Open first: a blocked pop-up used to leave the render marker
              // cleared and the approve button disabled forever, with no hint
              // that anything went wrong.
              const previewWindow = window.open(getProjectPreviewUrl(), '_blank');
              if (!previewWindow) {
                toast.error('Vorschau konnte nicht geöffnet werden — bitte Pop-ups für diese Seite erlauben.');
                return;
              }
              window.localStorage?.removeItem('studio:last-rendered-preview-url');
              setLastRenderedPreviewUrl(null);
            }}
            disabled={requiresProjectSelection}
          >
            Vorschau öffnen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={handleApprovePreview}
            disabled={requiresProjectSelection || !hasRenderedPreviewForSelectedProject || isApprovingPreview || isPublishing}
          >
            {isApprovingPreview ? (
              <>
                <Spinner />
                Wird freigegeben...
              </>
            ) : previewApproved ? (
              <>
                <Icon name="check" />
                Vorschau freigegeben
              </>
            ) : (
              'Vorschau freigeben'
            )}
          </Button>
          {!previewApproved && !hasRenderedPreviewForSelectedProject && (
            <span className="text-[10px] text-muted-foreground">
              Vorschau zuerst öffnen und vollständig laden lassen.
            </span>
          )}
          {previewApprovedAt && (
            <span className="text-[10px] text-muted-foreground">
              Freigegeben {formatRelativeTime(previewApprovedAt, false)}
            </span>
          )}
        </div>

        <hr className="my-3" />

        <Button
          size="sm"
          className="w-full"
          onClick={handlePublishAll}
          disabled={requiresProjectSelection || livePublishBlocked || isPublishing || publishSuccess}
        >
          {isPublishing ? (
            <>
              <Spinner />
              {publishedAt ? 'Aktualisierung läuft...' : 'Live-Schaltung läuft...'}
            </>
          ) : publishSuccess ? (
            <>
              <Icon name="check" />
              Aktualisiert
            </>
          ) : (
            publishedAt ? 'Aktualisieren' : 'Live schalten'
          )}
        </Button>
        {isPublishing && (
          <span className="mt-1 block text-[10px] text-muted-foreground">
            Live-Update wird gespeichert und Deployment wird angestoßen. Das kann kurz dauern.
          </span>
        )}
        {livePublishBlocked && (
          <span className="text-[10px] text-muted-foreground">
            {livePublishBlockerMessage}
          </span>
        )}

        <hr className="my-3" />

        {isLoadingCount ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Änderungen werden berechnet...
          </div>
        ) : publishReadiness?.projectScopedPublishAvailable !== true ? (
          <span className="text-xs text-muted-foreground">
            Änderungszählung wartet auf projektgebundenes Publishing.
          </span>
        ) : changeCounts ? (
          changeCounts.total > 0 ? (
            <Collapsible>
              <div className="flex items-center justify-between w-full">
                <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                  <div className="size-5.5 flex items-center justify-center bg-input rounded-md">
                    <Icon
                      name="chevronRight"
                      className="size-2.5 transition-transform group-data-[state=open]:rotate-90"
                    />
                  </div>
                  {changeCounts.total} {changeCounts.total === 1 ? 'Änderung' : 'Änderungen'}
                </CollapsibleTrigger>
                {publishedAt && (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setIsRevertDialogOpen(true)}
                    disabled={isReverting || isPublishing}
                  >
                    Rollback
                  </Button>
                )}
              </div>
              <CollapsibleContent>
                <div className="flex flex-col gap-1.5 pt-1.5">
                  {BREAKDOWN_ITEMS.map(({ key, label, icon }) =>
                    changeCounts[key] > 0 ? (
                      <div key={key} className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <div className="size-5.5 flex items-center justify-center bg-input rounded-md">
                            <Icon name={icon} className="size-2.5" />
                          </div>
                          {label}
                        </span>
                        <span>{changeCounts[key]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <span className="text-xs text-muted-foreground">Alles ist aktuell</span>
          )
        ) : null}
      </PopoverContent>
    </Popover>

    <Dialog
      open={isRevertDialogOpen}
      onOpenChange={(open) => { if (!isReverting) setIsRevertDialogOpen(open); }}
    >
      <DialogContent
        showCloseButton={false}
        onPointerDownOutside={(e) => { if (isReverting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (isReverting) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Auf Live-Version zurücksetzen</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <DialogDescription>
            Alle unveröffentlichten Änderungen werden verworfen und durch die letzte
            Live-Version ersetzt. Das Studio lädt danach neu.
          </DialogDescription>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsRevertDialogOpen(false)}
            disabled={isReverting}
          >
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleRevertConfirm}
            disabled={isReverting}
          >
            {isReverting ? <><Spinner /> Rollback läuft...</> : 'Rollback'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
