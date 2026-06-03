export const STUDIO_ADMIN_ROLE = 'studio_admin';
export const STUDIO_DEVELOPER_ROLE = 'studio_developer';
export const CUSTOMER_OWNER_ROLE = 'customer_owner';
export const CUSTOMER_EDITOR_ROLE = 'customer_editor';
export const CUSTOMER_VIEWER_ROLE = 'customer_viewer';

export type StudioRole =
  | typeof STUDIO_ADMIN_ROLE
  | typeof STUDIO_DEVELOPER_ROLE
  | typeof CUSTOMER_OWNER_ROLE
  | typeof CUSTOMER_EDITOR_ROLE
  | typeof CUSTOMER_VIEWER_ROLE;

export const STUDIO_OPERATOR_ROLES: StudioRole[] = [
  STUDIO_ADMIN_ROLE,
  STUDIO_DEVELOPER_ROLE,
];

export const STUDIO_WRITE_ROLES: StudioRole[] = [
  STUDIO_ADMIN_ROLE,
  STUDIO_DEVELOPER_ROLE,
  CUSTOMER_OWNER_ROLE,
  CUSTOMER_EDITOR_ROLE,
];

export const STUDIO_READ_ROLES: StudioRole[] = [
  ...STUDIO_WRITE_ROLES,
  CUSTOMER_VIEWER_ROLE,
];

export const STUDIO_INTEGRATION_MANAGER_ROLES: StudioRole[] = [
  STUDIO_ADMIN_ROLE,
  STUDIO_DEVELOPER_ROLE,
  CUSTOMER_OWNER_ROLE,
];

export function normalizeStudioRole(role: string | null | undefined): StudioRole | null {
  switch (role) {
    case STUDIO_ADMIN_ROLE:
    case 'site_admin':
      return STUDIO_ADMIN_ROLE;
    case STUDIO_DEVELOPER_ROLE:
    case 'site_developer':
      return STUDIO_DEVELOPER_ROLE;
    case CUSTOMER_OWNER_ROLE:
    case CUSTOMER_EDITOR_ROLE:
    case CUSTOMER_VIEWER_ROLE:
      return role;
    default:
      return null;
  }
}

export function hasAllowedStudioRole(
  role: string | null | undefined,
  allowedRoles: readonly StudioRole[]
): boolean {
  const normalizedRole = normalizeStudioRole(role);
  return Boolean(normalizedRole && allowedRoles.includes(normalizedRole));
}

export function isStudioOperatorRole(role: string | null | undefined): boolean {
  return hasAllowedStudioRole(role, STUDIO_OPERATOR_ROLES);
}

export function canManageStudioIntegrations(role: string | null | undefined): boolean {
  return hasAllowedStudioRole(role, STUDIO_INTEGRATION_MANAGER_ROLES);
}
