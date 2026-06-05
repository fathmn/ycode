'use client';

import { studioFetch } from '@/lib/api';
import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  api_key?: string; // Only present when newly created
  last_used_at: string | null;
  created_at: string;
}

export default function ApiPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<ApiKey | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch API keys on mount
  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const response = await studioFetch('/ycode/api/api-keys');
      const result = await response.json();
      if (result.data) {
        setApiKeys(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKey = async () => {
    if (!newKeyName.trim()) return;

    setIsGenerating(true);
    try {
      const response = await studioFetch('/ycode/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });

      const result = await response.json();
      if (result.data) {
        setGeneratedKey(result.data);
        setShowGenerateDialog(false);
        setShowKeyDialog(true);
        setNewKeyName('');
        // Refresh the list
        fetchApiKeys();
      }
    } catch (error) {
      console.error('Failed to generate API key:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!keyToDelete) return;

    try {
      await studioFetch(`/ycode/api/api-keys/${keyToDelete.id}`, {
        method: 'DELETE',
      });
      setApiKeys(apiKeys.filter(k => k.id !== keyToDelete.id));
    } catch (error) {
      console.error('Failed to delete API key:', error);
    } finally {
      setShowDeleteDialog(false);
      setKeyToDelete(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatLastUsed = (dateString: string | null) => {
    if (!dateString) return 'Nie';
    return formatDate(dateString);
  };

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">

        <header className="pt-8 pb-6 flex items-center justify-between">
          <span className="text-base font-medium">Studio API</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowGenerateDialog(true)}
          >
            API-Schlüssel erstellen
          </Button>
        </header>

        <p className="text-sm text-muted-foreground mb-6">
          Verwalten Sie API-Schlüssel für den Zugriff auf die öffentliche API dieser Website.
        </p>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Lädt...
          </div>
        ) : apiKeys.length > 0 ? (
          <div className="flex flex-col gap-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center gap-4 p-4 bg-secondary/20 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <Label className="font-medium">{key.name}</Label>
                    <code className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                      {key.key_prefix}...
                    </code>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Erstellt am {formatDate(key.created_at)} · Zuletzt genutzt: {formatLastUsed(key.last_used_at)}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="xs"
                    >
                      <Icon name="more" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => {
                        setKeyToDelete(key);
                        setShowDeleteDialog(true);
                      }}
                    >
                      Löschen
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground text-sm border border-dashed rounded-lg">
            Noch keine API-Schlüssel. Klicken Sie auf &bdquo;API-Schlüssel erstellen&ldquo;, um einen Schlüssel anzulegen.
          </div>
        )}

        <header className="pt-10 pb-3">
          <span className="text-base font-medium">API-Dokumentation</span>
        </header>

        <div className="flex flex-col gap-8 bg-secondary/20 p-8 rounded-lg text-sm">

          {/* Authentication */}
          <section>
            <h3 className="font-medium mb-2">Authentifizierung</h3>
            <p className="text-muted-foreground mb-3">
              Alle API-Anfragen benötigen einen gültigen API-Schlüssel im <code className="text-xs bg-secondary px-1 py-0.5 rounded">Authorization</code>-Header:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`Authorization: Bearer YOUR_API_KEY`}
            </pre>
          </section>

          {/* Endpoints */}
          <section>
            <h3 className="font-medium mb-2">Endpoints</h3>
            <div className="space-y-4">

              <div>
                <h4 className="text-muted-foreground mb-1">Collections</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /api/v1/collections</div>
                  <div><span className="text-green-500">GET</span> /api/v1/collections/{'{collection_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Collection-Einträge</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /api/v1/collections/{'{collection_id}'}/items</div>
                  <div><span className="text-blue-500">POST</span> /api/v1/collections/{'{collection_id}'}/items</div>
                  <div><span className="text-green-500">GET</span> /api/v1/collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-yellow-500">PUT</span> /api/v1/collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-yellow-500">PATCH</span> /api/v1/collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                  <div><span className="text-red-500">DELETE</span> /api/v1/collections/{'{collection_id}'}/items/{'{item_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Forms</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /api/v1/forms</div>
                  <div><span className="text-green-500">GET</span> /api/v1/forms/{'{form_id}'}</div>
                </div>
              </div>

              <div>
                <h4 className="text-muted-foreground mb-1">Formular-Einsendungen</h4>
                <div className="bg-secondary p-3 rounded-lg space-y-1 text-xs font-mono">
                  <div><span className="text-green-500">GET</span> /api/v1/forms/{'{form_id}'}/submissions</div>
                  <div><span className="text-blue-500">POST</span> /api/v1/forms/{'{form_id}'}/submissions</div>
                  <div><span className="text-yellow-500">PATCH</span> /api/v1/forms/{'{form_id}'}/submissions/{'{submission_id}'}</div>
                  <div><span className="text-red-500">DELETE</span> /api/v1/forms/{'{form_id}'}/submissions/{'{submission_id}'}</div>
                </div>
              </div>

            </div>
          </section>

          {/* Collections API */}
          <section>
            <h3 className="font-medium mb-2">Collections API</h3>
            <p className="text-muted-foreground mb-3">
              Einträge werden mit ihren Feldwerten zurückgegeben. Referenzfelder enthalten die verknüpften Eintragsdaten.
            </p>

            <div className="space-y-4">
              <div>
                <div className="font-medium text-xs mb-2">Einträge auflisten</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Unterstützt Paginierung mit <code className="bg-secondary px-1 py-0.5 rounded">page</code> und <code className="bg-secondary px-1 py-0.5 rounded">per_page</code> (max. 100).
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /api/v1/collections/{collection_id}/items?page=1&per_page=50`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Eintrag erstellen</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Übergeben Sie Feldwerte mit den <strong>Feldnamen</strong> als Schlüssel. Bei Referenzfeldern wird die <code className="bg-secondary px-1 py-0.5 rounded">_id</code> (UUID) des referenzierten Eintrags übergeben.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`POST /api/v1/collections/{collection_id}/items
Content-Type: application/json

{
  "Name": "My Blog Post",
  "Slug": "my-blog-post",
  "Author": "550e8400-e29b-41d4-a716-446655440000"
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Eintrag aktualisieren</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Nutzen Sie <code className="bg-secondary px-1 py-0.5 rounded">PUT</code> für vollständige Ersetzungen oder <code className="bg-secondary px-1 py-0.5 rounded">PATCH</code> für teilweise Aktualisierungen.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`PATCH /api/v1/collections/{collection_id}/items/{item_id}
Content-Type: application/json

{
  "Name": "Updated Title"
}`}
                </pre>
              </div>
            </div>
          </section>

          {/* Response Format */}
          <section>
            <h3 className="font-medium mb-2">Antwortformat</h3>
            <p className="text-muted-foreground mb-3">
              Einträge enthalten Systemfelder (<code className="text-xs bg-secondary px-1 py-0.5 rounded">_id</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">ID</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">Created Date</code>, <code className="text-xs bg-secondary px-1 py-0.5 rounded">Updated Date</code>) sowie alle Feldwerte der Collection:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`{
  "_id": "550e8400-e29b-41d4-a716-446655440000",
  "ID": "1",
  "Name": "My Blog Post",
  "Slug": "my-blog-post",
  "Created Date": "2026-01-05T10:00:00.000Z",
  "Updated Date": "2026-01-05T12:30:00.000Z",
  "Author": { "_id": "...", "Name": "John Doe" }
}`}
            </pre>
          </section>

          {/* Protected Fields */}
          <section>
            <h3 className="font-medium mb-2">Geschützte Felder</h3>
            <p className="text-muted-foreground mb-3">
              Diese automatisch erzeugten Felder können über die API nicht gesetzt oder geändert werden:
            </p>
            <div className="bg-secondary p-3 rounded-lg text-xs space-y-2">
              <div><code className="text-blue-400">ID</code> - Fortlaufende Nummer, wird beim Erstellen vergeben</div>
              <div><code className="text-blue-400">Created Date</code> - Wird beim Erstellen automatisch gesetzt</div>
              <div><code className="text-blue-400">Updated Date</code> - Wird bei jeder Änderung automatisch aktualisiert</div>
            </div>
          </section>

          {/* Forms API */}
          <section>
            <h3 className="font-medium mb-2">Forms API</h3>
            <p className="text-muted-foreground mb-3">
              Greifen Sie programmatisch auf Formular-Einsendungen zu. Formulare werden über ihre <code className="text-xs bg-secondary px-1 py-0.5 rounded">form_id</code> identifiziert. Diese ID wird in den Einstellungen des Formular-Elements gesetzt.
            </p>

            <div className="space-y-4">
              <div>
                <div className="font-medium text-xs mb-2">Alle Formulare auflisten</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /api/v1/forms

// Response:
{
  "forms": [
    {
      "id": "contact-form",
      "submissionCount": 42,
      "newCount": 5,
      "latestSubmission": "2026-01-29T10:30:00.000Z"
    }
  ]
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Formulardetails abrufen</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /api/v1/forms/{form_id}

// Response:
{
  "id": "contact-form",
  "submissionCount": 42,
  "statusCounts": {
    "new": 5,
    "read": 30,
    "archived": 7,
    "spam": 0
  },
  "latestSubmission": "2026-01-29T10:30:00.000Z"
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Einsendungen auflisten</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Unterstützt Paginierung und Filterung nach Status.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`GET /api/v1/forms/{form_id}/submissions?page=1&per_page=50&status=new

// Response:
{
  "submissions": [
    {
      "id": "uuid",
      "formId": "contact-form",
      "payload": { "name": "John", "email": "john@example.com" },
      "metadata": { "user_agent": "...", "referrer": "..." },
      "status": "new",
      "createdAt": "2026-01-29T10:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "perPage": 50, "total": 42 }
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Einsendung erstellen</div>
                <p className="text-muted-foreground text-xs mb-2">
                  Senden Sie Formulardaten programmatisch, zum Beispiel aus externen Frontends oder Integrationen.
                </p>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`POST /api/v1/forms/{form_id}/submissions
Content-Type: application/json

{
  "payload": {
    "name": "John Doe",
    "email": "john@example.com",
    "message": "Hello!"
  },
  "metadata": {
    "page_url": "/contact"
  }
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Einsendungsstatus aktualisieren</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`PATCH /api/v1/forms/{form_id}/submissions/{submission_id}
Content-Type: application/json

{
  "status": "read"  // new, read, archived, spam
}`}
                </pre>
              </div>

              <div>
                <div className="font-medium text-xs mb-2">Einsendung löschen</div>
                <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`DELETE /api/v1/forms/{form_id}/submissions/{submission_id}

// Returns 204 No Content on success`}
                </pre>
              </div>
            </div>
          </section>

          {/* Error Responses */}
          <section>
            <h3 className="font-medium mb-2">Fehlerantworten</h3>
            <p className="text-muted-foreground mb-3">
              Fehler geben ein JSON-Objekt mit den Feldern <code className="text-xs bg-secondary px-1 py-0.5 rounded">error</code> und <code className="text-xs bg-secondary px-1 py-0.5 rounded">code</code> zurück:
            </p>
            <pre className="bg-secondary p-3 rounded-lg text-xs overflow-x-auto">
{`{
  "error": "Collection not found",
  "code": "NOT_FOUND"
}`}
            </pre>
            <div className="mt-3 text-xs text-muted-foreground space-y-1">
              <div><code className="text-yellow-400">401</code> - API-Schlüssel fehlt oder ist ungültig</div>
              <div><code className="text-yellow-400">404</code> - Collection oder Eintrag nicht gefunden</div>
              <div><code className="text-yellow-400">400</code> - Ungültiger Request Body</div>
              <div><code className="text-yellow-400">500</code> - Interner Serverfehler</div>
            </div>
          </section>

        </div>

      </div>

      {/* Generate API Key Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API-Schlüssel erstellen</DialogTitle>
            <DialogDescription>
              Erstellen Sie einen neuen API-Schlüssel für den Zugriff auf die öffentliche API dieser Website.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-6">
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <FieldDescription>
                Ein beschreibender Name, damit Sie diesen Schlüssel später wiedererkennen, zum Beispiel &bdquo;Production&ldquo; oder &bdquo;CI/CD&ldquo;.
              </FieldDescription>
              <Input
                id="key-name"
                placeholder="Mein API-Schlüssel"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKeyName.trim()) {
                    handleGenerateKey();
                  }
                }}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowGenerateDialog(false);
                setNewKeyName('');
              }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleGenerateKey}
              disabled={!newKeyName.trim() || isGenerating}
            >
              {isGenerating ? 'Wird erstellt...' : 'Schlüssel erstellen'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Generated Key Dialog */}
      <Dialog
        open={showKeyDialog} onOpenChange={(open) => {
          if (!open) {
            setShowKeyDialog(false);
            setGeneratedKey(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API-Schlüssel erstellt</DialogTitle>
            <DialogDescription>
              Kopieren Sie den API-Schlüssel jetzt. Er wird später nicht erneut vollständig angezeigt.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="p-4 bg-secondary rounded-lg">
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono break-all">
                  {generatedKey?.api_key}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => generatedKey?.api_key && copyToClipboard(generatedKey.api_key)}
                >
                  {copied ? (
                    <>
                      <Icon name="check" className="size-3.5 mr-1" />
                      Kopiert
                    </>
                  ) : (
                    <>
                      <Icon name="copy" className="size-3.5 mr-1" />
                      Kopieren
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <strong>Wichtig:</strong> Speichern Sie diesen Schlüssel sicher. Aus Sicherheitsgründen kann er später nicht erneut angezeigt werden.
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShowKeyDialog(false);
                setGeneratedKey(null);
                setCopied(false);
              }}
            >
              Fertig
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="API-Schlüssel löschen?"
        description={`Der API-Schlüssel "${keyToDelete?.name}" wird dauerhaft gelöscht. Anwendungen, die diesen Schlüssel verwenden, können danach nicht mehr auf die API zugreifen.`}
        confirmLabel="Schlüssel löschen"
        cancelLabel="Abbrechen"
        confirmVariant="destructive"
        onConfirm={handleDeleteKey}
        onCancel={() => {
          setShowDeleteDialog(false);
          setKeyToDelete(null);
        }}
      />
    </div>
  );
}
