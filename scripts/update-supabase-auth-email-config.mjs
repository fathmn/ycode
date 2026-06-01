#!/usr/bin/env node
/* global console, fetch */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_PROJECT_REF = 'ueeecqiswvxpfpmujrtj';
const DEFAULT_SENDER_EMAIL = 'no-reply@novum-partners.de';
const DEFAULT_SENDER_NAME = 'studio.novum partners';

function readArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

async function main() {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN is required to update Supabase Auth settings.');
  }

  const projectRef = readArg('project-ref') || process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
  const senderEmail = readArg('sender-email') || DEFAULT_SENDER_EMAIL;
  const senderName = readArg('sender-name') || DEFAULT_SENDER_NAME;
  const templatePath = path.join(process.cwd(), 'supabase', 'auth-email-templates', 'recovery.html');
  const recoveryTemplate = await fs.readFile(templatePath, 'utf8');

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      smtp_admin_email: senderEmail,
      smtp_sender_name: senderName,
      mailer_subjects_recovery: 'Passwort fuer studio.novum partners zuruecksetzen',
      mailer_templates_recovery_content: recoveryTemplate,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Auth config update failed (${response.status}): ${text}`);
  }

  console.log(JSON.stringify({
    ok: true,
    projectRef,
    senderEmail,
    senderName,
    updated: [
      'smtp_admin_email',
      'smtp_sender_name',
      'mailer_subjects_recovery',
      'mailer_templates_recovery_content',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
