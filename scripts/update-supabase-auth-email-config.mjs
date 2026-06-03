#!/usr/bin/env node
/* global console, fetch */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_PROJECT_REF = 'ueeecqiswvxpfpmujrtj';
const DEFAULT_SENDER_EMAIL = 'no-reply@novum-partners.de';
const DEFAULT_SENDER_NAME = 'Studio';
const DEFAULT_SITE_URL = 'https://studio.novum-partners.de';

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
  const siteUrl = readArg('site-url') || DEFAULT_SITE_URL;
  const recoveryTemplatePath = path.join(process.cwd(), 'supabase', 'auth-email-templates', 'recovery.html');
  const inviteTemplatePath = path.join(process.cwd(), 'supabase', 'auth-email-templates', 'invite.html');
  const recoveryTemplate = await fs.readFile(recoveryTemplatePath, 'utf8');
  const inviteTemplate = await fs.readFile(inviteTemplatePath, 'utf8');
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };

  const currentResponse = await fetch(endpoint, { headers });
  const currentText = await currentResponse.text();
  if (!currentResponse.ok) {
    throw new Error(`Supabase Auth config read failed (${currentResponse.status}): ${currentText}`);
  }

  const currentConfig = JSON.parse(currentText);
  const allowedRedirects = new Set(
    String(currentConfig.uri_allow_list || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  allowedRedirects.add(`${siteUrl}/ycode`);
  allowedRedirects.add(`${siteUrl}/ycode/api/auth/confirm`);

  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      smtp_admin_email: senderEmail,
      smtp_sender_name: senderName,
      mailer_subjects_invite: 'Einladung zu Studio',
      mailer_subjects_recovery: 'Passwort für Studio zurücksetzen',
      mailer_templates_invite_content: inviteTemplate,
      mailer_templates_recovery_content: recoveryTemplate,
      uri_allow_list: Array.from(allowedRedirects).join(','),
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
    siteUrl,
    updated: [
      'smtp_admin_email',
      'smtp_sender_name',
      'mailer_subjects_invite',
      'mailer_subjects_recovery',
      'mailer_templates_invite_content',
      'mailer_templates_recovery_content',
      'uri_allow_list',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
