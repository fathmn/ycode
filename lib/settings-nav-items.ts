import { isStudioOperatorRole } from '@/lib/studio-roles';

/**
 * Settings navigation items for the settings sidebar.
 * Extracted for reuse and to allow cloud overlay to filter items.
 */

export interface SettingsNavItem {
  id: string;
  label: string;
  path: string;
  operatorOnly?: boolean;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: 'general', label: 'Allgemein', path: '/ycode/settings/general' },
  { id: 'users', label: 'Benutzer', path: '/ycode/settings/users' },
  { id: 'redirects', label: 'Weiterleitungen', path: '/ycode/settings/redirects' },
  { id: 'email', label: 'E-Mail', path: '/ycode/settings/email', operatorOnly: true },
  { id: 'templates', label: 'Templates', path: '/ycode/settings/templates', operatorOnly: true },
  { id: 'updates', label: 'Updates', path: '/ycode/settings/updates', operatorOnly: true },
];

export function visibleSettingsNavItems(roles: Array<string | null | undefined>): SettingsNavItem[] {
  const isOperator = roles.some(isStudioOperatorRole);
  return SETTINGS_NAV_ITEMS.filter((item) => !item.operatorOnly || isOperator);
}
