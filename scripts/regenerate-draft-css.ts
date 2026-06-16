/**
 * Regenerates a project's draft_css setting through the real server-side
 * Tailwind compiler path: generateAndSaveDraftCSS.
 *
 * This writes only the project's draft_css setting via setSetting('draft_css',
 * css, projectId). It does not modify layers, published data, or any other
 * project state. The database connection comes from the standard environment
 * used by getSupabaseAdmin.
 */

import { generateAndSaveDraftCSS } from '@/lib/server/cssGenerator';

function printUsage() {
  console.error('Usage: npm run studio:regen-draft-css -- <projectId>');
}

async function main() {
  const projectId = process.argv[2]?.trim();

  if (!projectId) {
    printUsage();
    process.exit(1);
  }

  try {
    const css = await generateAndSaveDraftCSS(projectId);

    console.log(JSON.stringify({
      projectId,
      cssLength: css.length,
      fontFamilyRuleCount: css.match(/font-family:/g)?.length ?? 0,
      fontDisplayWithFallback: css.includes('var(--font-display,'),
      fontDisplayBroken: css.includes('var(--font-display),'),
    }, null, 2));

    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error && error.stack ? error.stack : error);
    process.exit(1);
  }
}

main();
