'use client';

import { studioFetch } from '@/lib/api';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Field, FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ButtonGroup } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import type { SitemapSettings, SitemapMode, SitemapChangeFrequency, Asset } from '@/types';
import { getDefaultSitemapSettings } from '@/lib/sitemap-utils';
import { getTimezoneOptions } from '@/lib/setting-utils';
import { getDetectedTimezone, isCloudVersion } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import FileManagerDialog from '../../components/FileManagerDialog';
import { toast } from 'sonner';
import { ASSET_CATEGORIES } from '@/lib/asset-constants';
import { buildEditorPath } from '@/hooks/use-editor-url';

export default function GeneralSettingsPage() {
  const [activeTab, setActiveTab] = useState('website');
  const { getSettingByKey, saveSettings } = useSettingsStore();

  // Initialize sitemap settings from store
  const storedSitemapSettings = getSettingByKey('sitemap') as SitemapSettings | null;
  const [sitemapSettings, setSitemapSettings] = useState<SitemapSettings>(
    storedSitemapSettings || getDefaultSitemapSettings()
  );
  const [isSaving, setIsSaving] = useState(false);

  // Initialize robots.txt and llms.txt from store
  const storedRobotsTxt = getSettingByKey('robots_txt') as string | null;
  const storedLlmsTxt = getSettingByKey('llms_txt') as string | null;
  const [robotsTxt, setRobotsTxt] = useState(storedRobotsTxt || '');
  const [llmsTxt, setLlmsTxt] = useState(storedLlmsTxt || '');

  // Initialize Google Analytics, Site Verification, and Canonical URL from store
  const storedGaMeasurementId = getSettingByKey('ga_measurement_id') as string | null;
  const storedGoogleSiteVerification = getSettingByKey('google_site_verification') as string | null;
  const storedGlobalCanonicalUrl = getSettingByKey('global_canonical_url') as string | null;
  const [gaMeasurementId, setGaMeasurementId] = useState(storedGaMeasurementId || '');
  const [googleSiteVerification, setGoogleSiteVerification] = useState(storedGoogleSiteVerification || '');
  const [globalCanonicalUrl, setGlobalCanonicalUrl] = useState(storedGlobalCanonicalUrl || '');

  // Initialize global custom code from store
  const storedCustomCodeHead = getSettingByKey('custom_code_head') as string | null;
  const storedCustomCodeBody = getSettingByKey('custom_code_body') as string | null;
  const [customCodeHead, setCustomCodeHead] = useState(storedCustomCodeHead || '');
  const [customCodeBody, setCustomCodeBody] = useState(storedCustomCodeBody || '');
  const [isSavingCustomCode, setIsSavingCustomCode] = useState(false);

  // Initialize Studio badge from store
  const storedYcodeBadge = getSettingByKey('ycode_badge') as boolean | null;
  const [ycodeBadge, setYcodeBadge] = useState(storedYcodeBadge ?? false);
  const [isSavingWebsite, setIsSavingWebsite] = useState(false);

  // Initialize timezone from store (default UTC)
  const storedTimezone = getSettingByKey('timezone') as string | null;
  const [timezone, setTimezone] = useState(storedTimezone ?? 'UTC');
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  // Initialize project (site) name from store.
  const storedSiteName = getSettingByKey('site_name') as string | null;
  const [siteName, setSiteName] = useState(storedSiteName || '');

  // Initialize favicon and web clip from store
  const storedFaviconAssetId = getSettingByKey('favicon_asset_id') as string | null;
  const storedWebClipAssetId = getSettingByKey('web_clip_asset_id') as string | null;
  const [faviconAssetId, setFaviconAssetId] = useState(storedFaviconAssetId || '');
  const [webClipAssetId, setWebClipAssetId] = useState(storedWebClipAssetId || '');

  // File manager dialog state
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileManagerMode, setFileManagerMode] = useState<'favicon' | 'webclip'>('favicon');

  // Stable category filter — favicon accepts both raster images and SVG icons.
  // Memoized to avoid creating a new array on every render, which would cause
  // the file manager to reload its asset list in a loop.
  const fileManagerCategory = useMemo(
    () => fileManagerMode === 'favicon'
      ? [ASSET_CATEGORIES.IMAGES, ASSET_CATEGORIES.ICONS]
      : ASSET_CATEGORIES.IMAGES,
    [fileManagerMode],
  );

  // Assets store for getting asset details
  const assetsById = useAssetsStore((state) => state.assetsById);
  const addAssetsToCache = useAssetsStore((state) => state.addAssetsToCache);

  // Fetch assets on mount if not already in cache
  useEffect(() => {
    const idsToFetch = [faviconAssetId, webClipAssetId].filter(
      (id) => id && !assetsById[id]
    );

    if (idsToFetch.length === 0) return;

    // Fetch missing assets
    Promise.all(
      idsToFetch.map((id) =>
        studioFetch(`/ycode/api/assets/${id}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((result) => result?.data as Asset | null)
          .catch(() => null)
      )
    ).then((fetchedAssets) => {
      const validAssets = fetchedAssets.filter((a): a is Asset => a !== null);
      if (validAssets.length > 0) {
        addAssetsToCache(validAssets);
      }
    });
  }, [faviconAssetId, webClipAssetId, assetsById, addAssetsToCache]);

  // Get asset details for display
  const faviconAsset = faviconAssetId ? assetsById[faviconAssetId] : null;
  const webClipAsset = webClipAssetId ? assetsById[webClipAssetId] : null;

  // Derive activeSeoTab from sitemap mode
  const activeSeoTab = sitemapSettings.mode === 'auto'
    ? 'ycode-sitemap'
    : sitemapSettings.mode === 'custom'
      ? 'custom-sitemap'
      : 'no-sitemap';

  // Update sitemap settings locally
  const updateSitemapSetting = useCallback(<K extends keyof SitemapSettings>(
    key: K,
    value: SitemapSettings[K]
  ) => {
    setSitemapSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Handle tab change for sitemap mode
  const handleSitemapTabChange = useCallback((tab: string) => {
    const mode: SitemapMode = tab === 'ycode-sitemap'
      ? 'auto'
      : tab === 'custom-sitemap'
        ? 'custom'
        : 'none';
    updateSitemapSetting('mode', mode);
  }, [updateSitemapSetting]);

  // Save SEO settings
  const saveSeoSettings = useCallback(async () => {
    setIsSaving(true);
    await saveSettings({
      sitemap: sitemapSettings,
      robots_txt: robotsTxt,
      llms_txt: llmsTxt,
      ga_measurement_id: gaMeasurementId,
      google_site_verification: googleSiteVerification,
      global_canonical_url: globalCanonicalUrl,
    });
    setIsSaving(false);
  }, [saveSettings, sitemapSettings, robotsTxt, llmsTxt, gaMeasurementId, googleSiteVerification, globalCanonicalUrl]);

  // Save custom code settings
  const saveCustomCodeSettings = useCallback(async () => {
    setIsSavingCustomCode(true);
    await saveSettings({
      custom_code_head: customCodeHead,
      custom_code_body: customCodeBody,
    });
    setIsSavingCustomCode(false);
  }, [saveSettings, customCodeHead, customCodeBody]);

  // Save website settings
  const saveWebsiteSettings = useCallback(async () => {
    const trimmedName = siteName.trim();
    if (!trimmedName) {
      toast.error('Projektname ist erforderlich');
      return;
    }

    setIsSavingWebsite(true);
    try {
      const success = await saveSettings({
        site_name: trimmedName,
        ycode_badge: ycodeBadge,
        timezone,
        favicon_asset_id: faviconAssetId || null,
        web_clip_asset_id: webClipAssetId || null,
      });

      if (!success) {
        toast.error(useSettingsStore.getState().error || 'Einstellungen konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.');
        return;
      }

      toast.success('Einstellungen wurden erfolgreich gespeichert');
    } finally {
      setIsSavingWebsite(false);
    }
  }, [siteName, saveSettings, ycodeBadge, timezone, faviconAssetId, webClipAssetId]);

  const handleDetectTimezone = useCallback(() => {
    const detected = getDetectedTimezone();
    if (detected) setTimezone(detected);
  }, []);

  // Open file manager for favicon or web clip selection
  const handleOpenFileManager = useCallback((mode: 'favicon' | 'webclip') => {
    setFileManagerMode(mode);
    setFileManagerOpen(true);
  }, []);

  // Handle asset selection from file manager with size validation
  const handleAssetSelect = useCallback((asset: Asset) => {
    const minSize = fileManagerMode === 'favicon' ? 32 : 256;
    const label = fileManagerMode === 'favicon' ? 'Favicon' : 'Webclip';

    // Validate image type
    if (!asset.mime_type?.startsWith('image/')) {
      toast.error(`${label} muss eine Bilddatei sein`);
      return false;
    }

    // SVGs scale without quality loss; skip dimension checks entirely
    const isSvg = asset.mime_type === 'image/svg+xml';

    if (!isSvg) {
      if (!asset.width || !asset.height) {
        toast.error('Bildabmessungen konnten nicht ermittelt werden');
        return false;
      }

      if (asset.width < minSize || asset.height < minSize) {
        toast.error(`${label} muss mindestens ${minSize}x${minSize} Pixel groß sein`, {
          description: `Ausgewähltes Bild: ${asset.width}x${asset.height} Pixel`,
        });
        return false;
      }
    }

    // Set the asset ID
    if (fileManagerMode === 'favicon') {
      setFaviconAssetId(asset.id);
    } else {
      setWebClipAssetId(asset.id);
    }

    setFileManagerOpen(false);
    return false; // Prevent default file manager behavior
  }, [fileManagerMode]);

  // Remove favicon or web clip
  const handleRemoveAsset = useCallback((mode: 'favicon' | 'webclip') => {
    if (mode === 'favicon') {
      setFaviconAssetId('');
    } else {
      setWebClipAssetId('');
    }
  }, []);

  // Reset project state
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetProject = useCallback(async () => {
    try {
      setIsResetting(true);

      const response = await studioFetch('/ycode/api/devtools/reset-db', {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Projekt konnte nicht zurückgesetzt werden');
      }

      window.location.href = buildEditorPath('/ycode');
    } catch (err) {
      console.error('Error resetting project:', err);
      toast.error(err instanceof Error ? err.message : 'Projekt konnte nicht zurückgesetzt werden');
      setIsResetting(false);
      setShowResetDialog(false);
    }
  }, []);

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <header className="pt-8 pb-3">
          <span className="text-base font-medium">Allgemeine Einstellungen</span>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="website">Website</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="custom-code">Custom Code</TabsTrigger>
          </TabsList>

          <TabsContent value="website" className="mt-2 flex flex-col gap-4">

            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Basisdaten</FieldLegend>
                <FieldDescription>Diese Informationen können öffentlich angezeigt werden. Teilen Sie hier nur Inhalte, die auf der Website sichtbar sein dürfen.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-5">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="project-name">
                    Projektname
                  </FieldLabel>
                  <Input
                    id="project-name"
                    placeholder="Meine Website"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    required
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex items-center gap-6">
                  <div className="size-28 bg-secondary/20 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {faviconAsset?.public_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={faviconAsset.public_url}
                        alt="Favicon-Vorschau"
                        className="size-8 object-contain"
                      />
                    ) : faviconAsset?.content ? (
                      <div
                        className="size-8 text-foreground"
                        dangerouslySetInnerHTML={{ __html: faviconAsset.content }}
                      />
                    ) : (
                      <Image
                        src={'/y-filled.svg'}
                        alt="Favicon-Vorschau"
                        width={32}
                        height={32}
                        className="size-8"
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Favicon
                    </FieldLabel>
                    <FieldDescription>
                      Mindestens 32 x 32 Pixel. ICO, PNG, GIF, SVG oder JPG.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-fit"
                        onClick={() => handleOpenFileManager('favicon')}
                      >
                        {faviconAssetId ? 'Ändern' : 'Auswählen'}
                      </Button>
                      {faviconAssetId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-fit"
                          onClick={() => handleRemoveAsset('favicon')}
                        >
                          Entfernen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-span-2 flex items-center gap-6">
                  <div className="size-28 bg-secondary/20 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {webClipAsset?.public_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={webClipAsset.public_url}
                        alt="Webclip-Vorschau"
                        className="size-16 rounded-[10px] object-cover"
                      />
                    ) : (
                      <Image
                        src={'/ycode-webclip.png'}
                        alt="Webclip-Vorschau"
                        width={64}
                        height={64}
                        className="size-16 rounded-[10px]"
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Webclip
                    </FieldLabel>
                    <FieldDescription>
                      Mindestens 256 x 256 Pixel. Wird angezeigt, wenn URLs auf dem Homescreen eines Smartphones oder in Browser-Lesezeichen gespeichert werden.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-fit"
                        onClick={() => handleOpenFileManager('webclip')}
                      >
                        {webClipAssetId ? 'Ändern' : 'Auswählen'}
                      </Button>
                      {webClipAssetId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-fit"
                          onClick={() => handleRemoveAsset('webclip')}
                        >
                          Entfernen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <FieldSeparator className="col-span-2" />

                <Field className="col-span-2">
                  <FieldLabel htmlFor="timezone">
                    Zeitzone
                  </FieldLabel>
                  <ButtonGroup className="w-full">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      className="shrink-0 rounded-lg"
                      onClick={handleDetectTimezone}
                      aria-label="Zeitzone automatisch erkennen"
                    >
                      <Icon name="map" className="size-3.5" />
                    </Button>

                    <Separator orientation="vertical" className="self-stretch" />

                    <Select value={timezone || undefined} onValueChange={setTimezone}>
                      <SelectTrigger id="timezone" className="flex-1">
                        <SelectValue placeholder="Zeitzone auswählen" />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ButtonGroup>
                </Field>

                <FieldSeparator className="col-span-2" />

                <Field orientation="horizontal" className="flex-row-reverse col-span-2">
                  <FieldContent>
                    <FieldLabel htmlFor="badge">Studio Badge anzeigen</FieldLabel>
                    <FieldDescription>
                      {isCloudVersion()
                        ? 'Für das Ausblenden des Badges ist ein Projekttarif erforderlich.'
                        : 'Optionales Studio Badge auf der Website anzeigen.'}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="badge"
                    checked={ycodeBadge}
                    onCheckedChange={setYcodeBadge}
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveWebsiteSettings}
                    disabled={isSavingWebsite}
                  >
                    {isSavingWebsite ? 'Speichert...' : 'Änderungen speichern'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Gefahrenbereich</FieldLegend>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-5">

                <div className="col-span-2 flex items-center gap-6">

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Projekt zurücksetzen
                    </FieldLabel>
                    <FieldDescription>
                      Setzt das Projekt auf eine leere Website zurück. Seiten, CMS-Collections, Assets und Einstellungen werden dauerhaft gelöscht.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowResetDialog(true)}
                      >
                        Projekt zurücksetzen
                      </Button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </TabsContent>

          <TabsContent value="seo" className="mt-2">
            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>SEO-Einstellungen</FieldLegend>
                <FieldDescription>Globale SEO-Einstellungen für dieses Projekt. Meta-Titel, Beschreibungen und Open-Graph-Daten können zusätzlich pro Seite oder CMS-Eintrag angepasst werden.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-8">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="google-analytics-measurement-id">
                    Google Analytics Measurement ID
                  </FieldLabel>
                  <FieldDescription>
                    Google Analytics in diese Website einbinden. Als Website-Betreiber sind Sie dafür verantwortlich, Datenschutzvorgaben wie die DSGVO einzuhalten.
                  </FieldDescription>
                  <Input
                    id="google-analytics-measurement-id"
                    value={gaMeasurementId}
                    onChange={(e) => setGaMeasurementId(e.target.value)}
                    placeholder="G-XXXXXXXX"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="google-site-verification">
                    Google Site Verification
                  </FieldLabel>
                  <FieldDescription>
                    Die Google-Verifizierung ermöglicht Zugriff auf private Google-Search-Daten dieser Website und hilft dabei, das Crawling zu steuern.
                  </FieldDescription>
                  <Input
                    id="google-site-verification"
                    value={googleSiteVerification}
                    onChange={(e) => setGoogleSiteVerification(e.target.value)}
                    placeholder="e.g. x88atPHmzG1G2FBivU1bk-w398zDtl8Mci2AC2tYd4kw"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-canonical-url">
                    Globale Canonical-URL
                  </FieldLabel>
                  <FieldDescription>
                    Legt die globale URL für den Canonical-Tag fest, damit Suchmaschinen die korrekte URL indexieren und doppelte Inhalte vermeiden.
                  </FieldDescription>
                  <Input
                    id="global-canonical-url"
                    value={globalCanonicalUrl}
                    onChange={(e) => setGlobalCanonicalUrl(e.target.value)}
                    placeholder="https://"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="robots">
                    Inhalt von &ldquo;robots.txt&rdquo;
                  </FieldLabel>
                  <FieldDescription>
                    Falls befüllt, ersetzt dieser Inhalt die Standarddatei /robots.txt.
                  </FieldDescription>
                  <Textarea
                    id="robots"
                    value={robotsTxt}
                    onChange={(e) => setRobotsTxt(e.target.value)}
                    placeholder={'User-agent: *\nAllow: /\nDisallow: /ycode/'}
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="llms">
                    Inhalt von &ldquo;llms.txt&rdquo;
                  </FieldLabel>
                  <FieldDescription>
                    Falls befüllt, ersetzt dieser Inhalt die Standarddatei /llms.txt.
                  </FieldDescription>
                  <Textarea
                    id="llms"
                    value={llmsTxt}
                    onChange={(e) => setLlmsTxt(e.target.value)}
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <Field className="col-span-2">
                  <FieldLabel htmlFor="sitemap">
                    Sitemap
                  </FieldLabel>
                  <FieldDescription>
                    Die sitemap.xml unterstützt Suchmaschinen mit einer strukturierten Liste der Seiten. Hier kann festgelegt werden, ob und wie sie generiert wird.
                  </FieldDescription>

                  <Tabs value={activeSeoTab} onValueChange={handleSitemapTabChange}>
                    <TabsList className="w-full">
                      <TabsTrigger value="no-sitemap">Keine Sitemap</TabsTrigger>
                      <TabsTrigger value="ycode-sitemap">Von Studio generiert</TabsTrigger>
                      <TabsTrigger value="custom-sitemap">Eigenes XML</TabsTrigger>
                    </TabsList>

                    <TabsContent value="no-sitemap" className="mt-4">
                      <p className="text-sm text-muted-foreground">
                        Für diese Website wird keine sitemap.xml generiert.
                      </p>
                    </TabsContent>

                    <TabsContent value="ycode-sitemap" className="mt-4 space-y-6">
                      <p className="text-sm text-muted-foreground">
                        Die Sitemap enthält automatisch lokalisierte URLs mit hreflang-Alternativen und schließt Seiten aus, die auf noindex gesetzt sind.
                      </p>

                      <Field>
                        <FieldLabel htmlFor="sitemap-changefreq">
                          Änderungsfrequenz
                        </FieldLabel>
                        <FieldDescription>
                          Wie häufig Seiten voraussichtlich geändert werden. Dies ist ein Hinweis für Suchmaschinen.
                        </FieldDescription>
                        <Select
                          value={sitemapSettings.defaultChangeFrequency || 'weekly'}
                          onValueChange={(value) => updateSitemapSetting('defaultChangeFrequency', value as SitemapChangeFrequency)}
                        >
                          <SelectTrigger id="sitemap-changefreq">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="always">Immer</SelectItem>
                            <SelectItem value="hourly">Stündlich</SelectItem>
                            <SelectItem value="daily">Täglich</SelectItem>
                            <SelectItem value="weekly">Wöchentlich</SelectItem>
                            <SelectItem value="monthly">Monatlich</SelectItem>
                            <SelectItem value="yearly">Jährlich</SelectItem>
                            <SelectItem value="never">Nie</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </TabsContent>

                    <TabsContent value="custom-sitemap" className="mt-4">
                      <Field>
                        <FieldLabel htmlFor="custom-sitemap-xml">
                          Eigenes Sitemap-XML
                        </FieldLabel>
                        <FieldDescription>
                          Eigenen Sitemap-XML-Inhalt einfügen. Dieser ersetzt die automatisch generierte Sitemap vollständig.
                        </FieldDescription>
                        <Textarea
                          id="custom-sitemap-xml"
                          value={sitemapSettings.customXml || ''}
                          onChange={(e) => updateSitemapSetting('customXml', e.target.value)}
                          placeholder={`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2024-01-01</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`}
                          className="font-mono text-sm min-h-50"
                        />
                      </Field>
                    </TabsContent>
                  </Tabs>
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveSeoSettings}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Speichert...' : 'Änderungen speichern'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="custom-code" className="mt-2">
            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Custom Code</FieldLegend>
                <FieldDescription>Code hinterlegen, der auf dieser Website eingebunden werden soll.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-8">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-code-head">
                    Header
                  </FieldLabel>
                  <FieldDescription>
                    Code, der auf jeder Seite in den &lt;head&gt;-Bereich eingefügt wird.
                  </FieldDescription>
                  <Textarea
                    id="global-code-head"
                    value={customCodeHead}
                    onChange={(e) => setCustomCodeHead(e.target.value)}
                    placeholder={'<script src="..."></script>\n<link rel="stylesheet" href="...">'}
                    className="min-h-30"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-code-body">
                    Body
                  </FieldLabel>
                  <FieldDescription>
                    Code, der auf jeder Seite vor dem schließenden &lt;/body&gt;-Tag eingefügt wird.
                  </FieldDescription>
                  <Textarea
                    id="global-code-body"
                    value={customCodeBody}
                    onChange={(e) => setCustomCodeBody(e.target.value)}
                    placeholder={'<script>...</script>'}
                    className="min-h-30"
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveCustomCodeSettings}
                    disabled={isSavingCustomCode}
                  >
                    {isSavingCustomCode ? 'Speichert...' : 'Änderungen speichern'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* File Manager Dialog for favicon/web clip selection */}
      <FileManagerDialog
        open={fileManagerOpen}
        onOpenChange={setFileManagerOpen}
        onAssetSelect={handleAssetSelect}
        assetId={fileManagerMode === 'favicon' ? faviconAssetId || null : webClipAssetId || null}
        category={fileManagerCategory}
      />

      {/* Reset Project Confirmation Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Projekt zurücksetzen</DialogTitle>
            <DialogDescription>
              Dadurch werden alle Projektdaten dauerhaft gelöscht, einschließlich Seiten, CMS-Collections, Assets und Einstellungen. Das Projekt wird auf eine leere Website zurückgesetzt. Diese Aktion kann nicht rückgängig gemacht werden.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowResetDialog(false)}
              disabled={isResetting}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleResetProject}
              disabled={isResetting}
            >
              {isResetting ? (
                <>
                  <Spinner />
                  Wird zurückgesetzt...
                </>
              ) : (
                'Projekt zurücksetzen'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
