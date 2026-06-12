'use client';

import { studioFetch } from '@/lib/api';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface McpToken {
  id: string;
  name: string;
  token?: string;
  token_prefix: string;
  mcp_url?: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  oauth_client_id: string | null;
  expires_at: string | null;
}

export default function McpPage() {
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [showUrlDialog, setShowUrlDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [tokenToDelete, setTokenToDelete] = useState<McpToken | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [generatedToken, setGeneratedToken] = useState<McpToken | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mcpBearerUrl, setMcpBearerUrl] = useState('/ycode/mcp');

  useEffect(() => {
    fetchTokens();
    setMcpBearerUrl(`${window.location.origin}/ycode/mcp`);
  }, []);

  const fetchTokens = async () => {
    try {
      const response = await studioFetch('/ycode/api/mcp-tokens');
      const result = await response.json();
      if (result.data) {
        setTokens(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch MCP tokens:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!newTokenName.trim()) return;

    setIsGenerating(true);
    try {
      const response = await studioFetch('/ycode/api/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTokenName.trim() }),
      });

      const result = await response.json();
      if (result.data) {
        setGeneratedToken(result.data);
        setShowGenerateDialog(false);
        setShowUrlDialog(true);
        setNewTokenName('');
        fetchTokens();
      }
    } catch (error) {
      console.error('Failed to generate MCP token:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteToken = async () => {
    if (!tokenToDelete) return;

    try {
      await studioFetch(`/ycode/api/mcp-tokens/${tokenToDelete.id}`, {
        method: 'DELETE',
      });
      setTokens(tokens.filter(t => t.id !== tokenToDelete.id));
    } catch (error) {
      console.error('Failed to delete MCP token:', error);
    } finally {
      setShowDeleteDialog(false);
      setTokenToDelete(null);
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

  const isOAuthToken = (token: McpToken) => Boolean(token.oauth_client_id);

  const tokenStatusLabel = (token: McpToken) => {
    if (!isOAuthToken(token)) return 'URL token';
    if (token.expires_at && new Date(token.expires_at).getTime() < Date.now()) {
      return 'OAuth (expired)';
    }
    return 'OAuth';
  };

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">

        <header className="pt-8 pb-6 flex items-center justify-between">
          <span className="text-base font-medium">MCP</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowGenerateDialog(true)}
          >
            MCP-URL erstellen
          </Button>
        </header>

        <p className="text-sm text-muted-foreground mb-6">
          Verbinden Sie KI-Assistenten wie Claude, Cursor oder Windsurf mit diesem Studio-Projekt.
          Erstellen Sie eine MCP-URL und hinterlegen Sie sie in den Connector-Einstellungen Ihres KI-Tools.
        </p>

        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            Lädt...
          </div>
        ) : tokens.length > 0 ? (
          <div className="flex flex-col gap-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center gap-4 p-4 bg-secondary/20 rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <Label className="font-medium">{token.name}</Label>
                    <code className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-mono">
                      {token.token_prefix}...
                    </code>
                    <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                      {tokenStatusLabel(token)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Erstellt am {formatDate(token.created_at)} · Zuletzt genutzt: {formatLastUsed(token.last_used_at)}
                    {isOAuthToken(token) && token.expires_at
                      ? <> · Läuft ab am {formatDate(token.expires_at)}</>
                      : null}
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
                        setTokenToDelete(token);
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
            Noch keine MCP-Verbindungen. Klicken Sie auf &bdquo;MCP-URL erstellen&ldquo;, um eine Verbindung anzulegen.
          </div>
        )}

        <header className="pt-10 pb-3">
          <span className="text-base font-medium">So verbinden Sie ein Tool</span>
        </header>

        <div className="flex flex-col gap-6 bg-secondary/20 p-6 rounded-lg text-sm">
          <section>
            <h3 className="font-medium mb-2">Claude Desktop</h3>
            <p className="text-muted-foreground">
              Einstellungen &rarr; Connectors &rarr; Add custom connector &rarr; MCP-URL einfügen
            </p>
          </section>

          <section>
            <h3 className="font-medium mb-2">Cursor</h3>
            <p className="text-muted-foreground">
              Einstellungen &rarr; MCP &rarr; Add new MCP server &rarr; Typ: &bdquo;SSE&ldquo; &rarr; MCP-URL einfügen
            </p>
          </section>

          <section>
            <h3 className="font-medium mb-2">Weitere KI-Tools</h3>
            <p className="text-muted-foreground">
              Jedes KI-Tool mit MCP Streamable HTTP Transport kann sich über diese URL verbinden.
              Es ist kein zusätzlicher API-Schlüssel nötig, weil die URL bereits den Authentifizierungstoken enthält.
            </p>
          </section>

          <section>
            <h3 className="font-medium mb-2">Claude.ai web / ChatGPT (OAuth)</h3>
            <p className="text-muted-foreground">
              These clients connect via OAuth. Add a custom connector pointing to{' '}
              <code className="text-xs bg-secondary px-1.5 py-0.5 rounded font-mono">
                {mcpBearerUrl}
              </code>{' '}
              and you&apos;ll be prompted to approve access from this page. OAuth-issued tokens appear in the
              list above and can be revoked at any time.
            </p>
          </section>
        </div>

        {/* Generate Dialog */}
        <Dialog
          open={showGenerateDialog}
          onOpenChange={setShowGenerateDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>MCP-URL erstellen</DialogTitle>
              <DialogDescription>
                Erstellen Sie eine eindeutige MCP-URL, um einen KI-Assistenten mit diesem Studio-Projekt zu verbinden.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="token-name">Verbindungsname</Label>
              <Input
                id="token-name"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="z. B. Claude Desktop, Cursor"
                className="mt-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleGenerateToken();
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowGenerateDialog(false);
                  setNewTokenName('');
                }}
              >
                Abbrechen
              </Button>
              <Button
                onClick={handleGenerateToken}
                disabled={!newTokenName.trim() || isGenerating}
              >
                {isGenerating ? 'Wird erstellt...' : 'Erstellen'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* URL Display Dialog */}
        <Dialog
          open={showUrlDialog}
          onOpenChange={setShowUrlDialog}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ihre MCP-URL</DialogTitle>
              <DialogDescription>
                Kopieren Sie diese URL und fügen Sie sie in Ihrem KI-Tool ein. Die URL wird nur einmal vollständig angezeigt.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {generatedToken?.mcp_url && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-secondary px-3 py-2.5 rounded-lg font-mono break-all select-all">
                    {generatedToken.mcp_url}
                  </code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(generatedToken.mcp_url!)}
                  >
                    {copied ? 'Kopiert!' : 'Kopieren'}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                Halten Sie diese URL vertraulich. Wer diese URL besitzt, kann über MCP auf dieses Studio-Projekt zugreifen.
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setShowUrlDialog(false);
                  setGeneratedToken(null);
                }}
              >
                Fertig
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title="MCP-Verbindung löschen"
          description={`Soll die Verbindung "${tokenToDelete?.name}" wirklich gelöscht werden? KI-Tools mit dieser URL können sich danach nicht mehr verbinden.`}
          confirmLabel="Löschen"
          onConfirm={handleDeleteToken}
          confirmVariant="destructive"
        />
      </div>
    </div>
  );
}
