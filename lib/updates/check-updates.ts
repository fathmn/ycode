/**
 * Check for upstream updates from the official repository.
 * Extracted for reuse and to allow cloud overlay to return "no update" in hosted deployments.
 */

const UPSTREAM_REPO = 'ycode/ycode'; // Official Ycode repo

export interface CheckUpdatesResult {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string | null;
  publishedAt?: string | null;
  updateInstructions?: {
    method: 'github-sync' | 'git-pull' | 'manual';
    steps: string[];
    autoSyncUrl?: string;
  };
  message?: string;
  error?: string;
}

/**
 * Simple version comparison (semantic versioning)
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aNum = aParts[i] || 0;
    const bNum = bParts[i] || 0;

    if (aNum > bNum) return 1;
    if (aNum < bNum) return -1;
  }

  return 0;
}

/**
 * Check for updates from the official upstream repository
 */
export async function checkForUpdates(currentVersion: string): Promise<CheckUpdatesResult> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Ycode-Update-Checker',
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return {
        available: false,
        currentVersion,
        message: 'Updates konnten nicht geprüft werden',
      };
    }

    const release = await response.json();
    const latestVersion = release.tag_name?.replace(/^v/, '') || '1.0.0';

    const hasUpdate =
      latestVersion !== currentVersion &&
      compareVersions(latestVersion, currentVersion) > 0;

    // Detect deployment environment
    const isVercel = process.env.VERCEL === '1';
    const vercelGitProvider = process.env.VERCEL_GIT_PROVIDER;
    const vercelGitRepoOwner = process.env.VERCEL_GIT_REPO_OWNER;
    const vercelGitRepoSlug = process.env.VERCEL_GIT_REPO_SLUG;

    // Check if user's repo is a fork of the official repo
    let isFork = false;
    if (vercelGitProvider === 'github' && vercelGitRepoOwner && vercelGitRepoSlug) {
      try {
        const repoResponse = await fetch(
          `https://api.github.com/repos/${vercelGitRepoOwner}/${vercelGitRepoSlug}`,
          {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'Ycode-Update-Checker',
            },
            cache: 'no-store',
          }
        );

        if (repoResponse.ok) {
          const repoData = await repoResponse.json();
          isFork =
            repoData.fork && repoData.parent?.full_name === UPSTREAM_REPO;
        }
      } catch (error) {
        console.error('Failed to check fork status:', error);
      }
    }

    // Determine update method
    let updateMethod: 'github-sync' | 'git-pull' | 'manual' = 'manual';
    let autoSyncUrl: string | undefined;
    let steps: string[] = [];

    if (
      isVercel &&
      vercelGitProvider === 'github' &&
      vercelGitRepoOwner &&
      vercelGitRepoSlug
    ) {
      if (isFork) {
        updateMethod = 'manual';
        autoSyncUrl = `https://github.com/${vercelGitRepoOwner}/${vercelGitRepoSlug}`;
        steps = [
          `<a href="https://github.com/${vercelGitRepoOwner}/${vercelGitRepoSlug}" target="_blank" class="underline font-semibold">Studio GitHub-Fork</a> öffnen`,
          'Aktuellen Studio-Patchstand committen oder eindeutig sichern',
          'Eigenen Upgrade-Branch erstellen, zum Beispiel <code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">update/ycode-0.18.0</code>',
          `Upstream holen und nur im Upgrade-Branch testen:<br/><code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">git fetch upstream && git merge upstream/main</code>`,
          'Typecheck, Build, Fetch-Guard, Import-Skript-Checks, Browser-Smoke, Preview/Publish-Smoke und Migrationsstatus ausführen',
          'Erst nach grünen Checks und Review in den stabilen Studio-Branch übernehmen',
        ];
      } else {
        updateMethod = 'manual';
        autoSyncUrl = `https://github.com/${vercelGitRepoOwner}/${vercelGitRepoSlug}`;
        steps = [
          '<strong class="text-yellow-300">Dieses Repository ist kein Fork.</strong> Für einfachere Updates sollte Das Studio-Team langfristig einen sauberen Fork der offiziellen Basis pflegen.',
          '',
          '<strong class="text-current">Aktualisierung nur über einen Upgrade-Branch:</strong>',
          'Aktuellen Studio-Patchstand committen oder eindeutig sichern',
          'Upgrade-Branch erstellen, zum Beispiel <code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">update/ycode-0.18.0</code>',
          `Upstream-Remote ergänzen, falls noch nicht vorhanden:<br/><code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">git remote add upstream https://github.com/${UPSTREAM_REPO}.git</code>`,
          `Upstream holen und nur im Upgrade-Branch testen:<br/><code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">git fetch upstream && git merge upstream/main</code>`,
          'Typecheck, Build, Fetch-Guard, Import-Skript-Checks, Browser-Smoke, Preview/Publish-Smoke und Migrationsstatus ausführen',
          'Erst nach grünen Checks, Review und bewusster Freigabe in den stabilen Studio-Branch übernehmen',
        ];
      }
    } else {
      updateMethod = 'manual';
      autoSyncUrl = `https://github.com/${UPSTREAM_REPO}`;
      steps = [
        'Update-Hinweis als Signal behandeln, nicht als Freigabe zum Blind-Update',
        'Aktuellen Studio-Patchstand committen oder eindeutig sichern',
        'Upgrade nur in einem eigenen Branch testen, zum Beispiel <code class="bg-blue-800 px-2 py-1 rounded text-xs font-mono">update/ycode-0.18.0</code>',
        'Konflikte bewusst in Branding, Auth/Projektzugriff, Preview/Publish, Audit/Backup und Import-Adaptern lösen',
        'Erst nach vollständigen Checks und Review übernehmen',
      ];
    }

    return {
      available: hasUpdate,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url,
      releaseNotes: release.body,
      publishedAt: release.published_at,
      updateInstructions: {
        method: updateMethod,
        steps,
        autoSyncUrl,
      },
    };
  } catch (error) {
    console.error('Failed to check for updates:', error);
    return {
      available: false,
      currentVersion,
      error: 'Updates konnten nicht geprüft werden',
    };
  }
}
