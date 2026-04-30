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
import { publishApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { toast } from 'sonner';

interface PublishPreviewCounts {
  pages: number;
  collections: number;
  collectionItems: number;
  components: number;
  layerStyles: number;
  assets: number;
  total: number;
}

/** Breakdown row config for rendering */
const BREAKDOWN_ITEMS: { key: keyof Omit<PublishPreviewCounts, 'total'>; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'pages', label: 'Seiten', icon: 'page' },
  { key: 'components', label: 'Komponenten', icon: 'component' },
  { key: 'collections', label: 'CMS-Collections', icon: 'database' },
  { key: 'collectionItems', label: 'CMS-Einträge', icon: 'database' },
  { key: 'layerStyles', label: 'Layer-Styles', icon: 'cube' },
  { key: 'assets', label: 'Assets', icon: 'image' },
];

interface PublishPopoverProps {
  isPublishing: boolean;
  setIsPublishing: (isPublishing: boolean) => void;
  baseUrl: string;
  publishedUrl: string;
  isDisabled?: boolean;
  onPublishSuccess: () => void;
}

export default function PublishPopover({
  isPublishing,
  setIsPublishing,
  baseUrl,
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

  const { getSettingByKey, updateSetting } = useSettingsStore();
  const publishedAt = getSettingByKey('published_at');

  // Load changes count when popover opens
  useEffect(() => {
    if (isOpen) {
      loadChangesCount();
    }
  }, [isOpen]);

  const loadChangesCount = async () => {
    setIsLoadingCount(true);
    try {
      const response = await publishApi.getPreview();
      setChangeCounts(response.data ?? null);
    } catch (error) {
      console.error('Failed to load changes count:', error);
      setChangeCounts(null);
    } finally {
      setIsLoadingCount(false);
    }
  };

  const handlePublishAll = useCallback(async () => {
    try {
      setIsPublishing(true);

      const result = await publishApi.publish({ publishAll: true });

      if (result.error) {
        throw new Error(result.error);
      }

      // Sync published timestamp to store from response
      if (result.data?.published_at_setting?.value) {
        updateSetting('published_at', result.data.published_at_setting.value);
      }

      toast.success('Website wurde live geschaltet', {
        action: {
          label: 'Öffnen',
          onClick: () => window.open(baseUrl + publishedUrl, '_blank'),
        },
      });

      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000);

      // Refresh counts in background (non-blocking)
      onPublishSuccess();
      loadChangesCount();
    } catch (error) {
      console.error('Failed to publish all:', error);
    } finally {
      setIsPublishing(false);
    }
  }, [baseUrl, publishedUrl, onPublishSuccess, setIsPublishing, updateSetting]);

  const handleApprovePreview = useCallback(async () => {
    try {
      setIsApprovingPreview(true);

      const result = await publishApi.approvePreview('/ycode/preview');

      if (result.error) {
        throw new Error(result.error);
      }

      setPreviewApprovedAt(result.data?.created_at || new Date().toISOString());
      toast.success('Vorschau für Live-Schaltung freigegeben');
    } catch (error) {
      console.error('Failed to approve preview:', error);
      toast.error(error instanceof Error ? error.message : 'Vorschau konnte nicht freigegeben werden');
    } finally {
      setIsApprovingPreview(false);
    }
  }, []);

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
        <Button size="sm" disabled={isDisabled}>Live schalten</Button>
      </PopoverTrigger>

      <PopoverContent className="mr-4 mt-0.5 w-64">
        <div>
          <Label>
            <a
              href={baseUrl + publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {baseUrl}
            </a>
          </Label>
          <span className="text-popover-foreground text-[10px]">
            {publishedAt ? `Live ${formatRelativeTime(publishedAt, false)}` : 'Noch nicht live geschaltet'}
          </span>
        </div>

        <hr className="my-3" />

        <div className="flex flex-col gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => window.open('/ycode/preview', '_blank')}
          >
            Vorschau öffnen
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={handleApprovePreview}
            disabled={isApprovingPreview || isPublishing}
          >
            {isApprovingPreview ? (
              <>
                <Spinner />
                Wird freigegeben...
              </>
            ) : previewApprovedAt ? (
              <>
                <Icon name="check" />
                Vorschau freigegeben
              </>
            ) : (
              'Vorschau freigeben'
            )}
          </Button>
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
          disabled={isPublishing || publishSuccess}
        >
          {isPublishing ? (
            <Spinner />
          ) : publishSuccess ? (
            <Icon name="check" />
          ) : (
            publishedAt ? 'Aktualisieren' : 'Live schalten'
          )}
        </Button>

        <hr className="my-3" />

        {isLoadingCount ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            Änderungen werden berechnet...
          </div>
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
