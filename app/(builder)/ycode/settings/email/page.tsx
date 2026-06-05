'use client';

import { studioFetch } from '@/lib/api';

import { useState, useEffect, useRef } from 'react';
import {
  FieldDescription,
  FieldLabel,
  Field,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SMTP_PRESETS, SMTP_PROVIDER_OPTIONS, type SmtpProvider } from '@/lib/email-presets';

type EmailMode = 'ycode' | 'custom';

interface EmailSettings {
  enabled: boolean;
  mode?: EmailMode;
  provider: SmtpProvider;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
}

const DEFAULT_SETTINGS: EmailSettings = {
  enabled: false,
  mode: undefined,
  provider: 'google',
  smtpHost: SMTP_PRESETS.google.host,
  smtpPort: SMTP_PRESETS.google.port,
  smtpUser: '',
  smtpPassword: '',
  fromEmail: '',
  fromName: '',
};

function resolveMode(data: Partial<EmailSettings> | null): EmailMode | undefined {
  if (!data) return undefined;
  if (data.mode) return data.mode;
  if (data.enabled) return 'custom';
  return undefined;
}

export default function EmailSettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedMode, setSelectedMode] = useState<EmailMode | undefined>(undefined);

  const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
  const savedSettingsRef = useRef<EmailSettings>(DEFAULT_SETTINGS);
  const savedModeRef = useRef<EmailMode | undefined>(undefined);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await studioFetch('/ycode/api/settings/email');
        if (response.ok) {
          const result = await response.json();
          if (result.data) {
            const loadedSettings: EmailSettings = {
              enabled: result.data.enabled ?? false,
              mode: result.data.mode,
              provider: result.data.provider ?? 'google',
              smtpHost: result.data.smtpHost ?? SMTP_PRESETS.google.host,
              smtpPort: result.data.smtpPort ?? SMTP_PRESETS.google.port,
              smtpUser: result.data.smtpUser ?? '',
              smtpPassword: result.data.smtpPassword ?? '',
              fromEmail: result.data.fromEmail ?? '',
              fromName: result.data.fromName ?? '',
            };
            const mode = resolveMode(result.data);
            setSettings(loadedSettings);
            setSelectedMode(mode);
            savedSettingsRef.current = loadedSettings;
            savedModeRef.current = mode;
          }
        } else if (response.status !== 404) {
          throw new Error('E-Mail-Einstellungen konnten nicht geladen werden');
        }
      } catch (err) {
        console.error('Error loading email settings:', err);
        setError('E-Mail-Einstellungen konnten nicht geladen werden');
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  useEffect(() => {
    const saved = savedSettingsRef.current;
    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(saved);
    const modeChanged = selectedMode !== savedModeRef.current;
    setHasChanges(settingsChanged || modeChanged);
  }, [settings, selectedMode]);

  const handleProviderChange = (provider: SmtpProvider) => {
    const preset = SMTP_PRESETS[provider];
    setSettings((prev) => ({
      ...prev,
      provider,
      smtpHost: preset.host,
      smtpPort: preset.port,
    }));
    setTestResult(null);
  };

  const handleSettingChange = <K extends keyof EmailSettings>(
    key: K,
    value: EmailSettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const handleModeSelect = (mode: EmailMode) => {
    setSelectedMode(mode);
    setTestResult(null);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const savePayload: EmailSettings = {
        ...settings,
        mode: selectedMode,
        enabled: selectedMode === 'custom',
      };

      const response = await studioFetch('/ycode/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: savePayload }),
      });

      if (!response.ok) {
        throw new Error('E-Mail-Einstellungen konnten nicht gespeichert werden');
      }

      savedSettingsRef.current = { ...savePayload };
      savedModeRef.current = selectedMode;
      setSettings(savePayload);
      setHasChanges(false);
    } catch (err) {
      console.error('Error saving email settings:', err);
      setError('E-Mail-Einstellungen konnten nicht gespeichert werden');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setIsTesting(true);
      setError(null);
      setTestResult(null);

      const response = await studioFetch('/ycode/api/settings/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      const result = await response.json();

      if (response.ok) {
        setTestResult({ success: true, message: 'Verbindung erfolgreich.' });
      } else {
        setTestResult({ success: false, message: result.error || 'Verbindung fehlgeschlagen' });
      }
    } catch (err) {
      console.error('Error testing connection:', err);
      setTestResult({ success: false, message: 'Verbindungstest fehlgeschlagen' });
    } finally {
      setIsTesting(false);
    }
  };

  const currentPreset = SMTP_PRESETS[settings.provider];

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-3xl mx-auto">
          <header className="pt-8 pb-3">
            <span className="text-base font-medium">Email</span>
          </header>
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <header className="pt-8 pb-3">
          <span className="text-base font-medium">Email</span>
        </header>

        <div className="flex flex-col gap-4">
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Ycode Servers option — disabled on opensource */}
          <div className="relative flex items-start gap-3 rounded-lg border p-4 opacity-50 cursor-not-allowed bg-secondary/20">
            <div className="flex h-5 items-center">
              <div className="size-4 rounded-full border-2 border-muted-foreground/30" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Studio</span>
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Nur in der Cloud verfügbar
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Verwalteter E-Mail-Versand über Studio, keine Konfiguration erforderlich.
              </p>
            </div>
          </div>

          {/* Custom SMTP option */}
          <button
            type="button"
            onClick={() => handleModeSelect('custom')}
            className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
              selectedMode === 'custom'
                ? 'border-primary bg-secondary/20 ring-1 ring-primary'
                : 'bg-secondary/20 hover:border-primary/50'
            }`}
          >
            <div className="flex h-5 items-center">
              <div
                className={`size-4 rounded-full border-2 transition-colors ${
                  selectedMode === 'custom'
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground/30'
                }`}
              >
                {selectedMode === 'custom' && (
                  <div className="size-full flex items-center justify-center">
                    <div className="size-1.5 rounded-full bg-primary-foreground" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium">Eigener SMTP-Server</span>
              <p className="text-xs text-muted-foreground mt-1">
                Eigene SMTP-Zugangsdaten für den Versand von E-Mails verwenden.
              </p>
            </div>
          </button>

          {/* SMTP Configuration — shown when Custom is selected */}
          {selectedMode === 'custom' && (
            <div className="flex flex-col gap-6 bg-secondary/20 p-8 rounded-lg">
              <Field>
                <FieldLabel htmlFor="smtp-provider">Anbieter</FieldLabel>
                <FieldDescription>
                  E-Mail-Anbieter für vorkonfigurierte Einstellungen auswählen.
                </FieldDescription>
                <Select
                  value={settings.provider}
                  onValueChange={(value) => handleProviderChange(value as SmtpProvider)}
                >
                  <SelectTrigger id="smtp-provider" className="w-full">
                    <SelectValue placeholder="Anbieter auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {SMTP_PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentPreset.note && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {currentPreset.note}
                  </p>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="smtp-host">SMTP Host</FieldLabel>
                <FieldDescription>
                  Hostname des SMTP-Servers.
                </FieldDescription>
                <Input
                  id="smtp-host"
                  placeholder="smtp.example.com"
                  value={settings.smtpHost}
                  onChange={(e) => handleSettingChange('smtpHost', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="smtp-port">SMTP Port</FieldLabel>
                <FieldDescription>
                  Port des SMTP-Servers (587 für TLS, 465 für SSL).
                </FieldDescription>
                <Input
                  id="smtp-port"
                  placeholder="587"
                  value={settings.smtpPort}
                  onChange={(e) => handleSettingChange('smtpPort', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="smtp-user">SMTP-Benutzername</FieldLabel>
                <FieldDescription>
                  Benutzername für die SMTP-Authentifizierung.
                </FieldDescription>
                <Input
                  id="smtp-user"
                  placeholder="user@example.com"
                  value={settings.smtpUser}
                  onChange={(e) => handleSettingChange('smtpUser', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="smtp-password">SMTP-Passwort</FieldLabel>
                <FieldDescription>
                  Passwort oder app-spezifisches Passwort für die SMTP-Authentifizierung.
                </FieldDescription>
                <Input
                  id="smtp-password"
                  type="password"
                  placeholder="••••••••"
                  value={settings.smtpPassword}
                  onChange={(e) => handleSettingChange('smtpPassword', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="from-email">Absender-E-Mail</FieldLabel>
                <FieldDescription>
                  E-Mail-Adresse, die als Absender angezeigt wird.
                </FieldDescription>
                <Input
                  id="from-email"
                  type="email"
                  placeholder="noreply@example.com"
                  value={settings.fromEmail}
                  onChange={(e) => handleSettingChange('fromEmail', e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="from-name">Absendername</FieldLabel>
                <FieldDescription>
                  Name, der als Absender angezeigt wird.
                </FieldDescription>
                <Input
                  id="from-name"
                  placeholder="My Company"
                  value={settings.fromName}
                  onChange={(e) => handleSettingChange('fromName', e.target.value)}
                />
              </Field>

              {testResult && (
                <div
                  className={`px-4 py-2 rounded-md text-sm ${
                    testResult.success
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {testResult.message}
                </div>
              )}

              <div className="flex justify-end border-t pt-6">
                <Button
                  variant="secondary"
                  onClick={handleTestConnection}
                  disabled={isTesting || !settings.smtpHost || !settings.smtpUser}
                >
                  {isTesting ? <Spinner className="size-4" /> : 'Verbindung testen'}
                </Button>
              </div>
            </div>
          )}

          {hasChanges && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Spinner className="size-4" /> : 'Änderungen speichern'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
