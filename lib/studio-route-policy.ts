import {
  STUDIO_INTEGRATION_MANAGER_ROLES,
  STUDIO_OPERATOR_ROLES,
  STUDIO_READ_ROLES,
  STUDIO_WRITE_ROLES,
} from '@/lib/studio-roles';
import type { StudioProjectRole } from '@/lib/studio-platform';

export type StudioRoutePolicy = {
  method?: string;
  requiredRoles: StudioProjectRole[];
  scope: 'project' | 'integration' | 'none';
  resourceParam?: string;
};

type StudioHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function studioRoutePolicyKey(method: StudioHttpMethod, routePattern: string): string {
  return `${method} ${routePattern}`;
}

const projectPolicy = (
  method: StudioHttpMethod,
  requiredRoles: StudioProjectRole[],
  resourceParam?: string,
): StudioRoutePolicy => ({
  method,
  requiredRoles,
  scope: 'project',
  ...(resourceParam ? { resourceParam } : {}),
});

const integrationPolicy = (
  method: StudioHttpMethod,
  resourceParam?: string,
): StudioRoutePolicy => ({
  method,
  requiredRoles: STUDIO_INTEGRATION_MANAGER_ROLES,
  scope: 'integration',
  ...(resourceParam ? { resourceParam } : {}),
});

const scopeOnlyPolicy = (
  method: StudioHttpMethod,
  resourceParam?: string,
): StudioRoutePolicy => ({
  method,
  requiredRoles: [],
  scope: 'none',
  ...(resourceParam ? { resourceParam } : {}),
});

const k = studioRoutePolicyKey;
const ownerRoles = STUDIO_INTEGRATION_MANAGER_ROLES;

export const STUDIO_ROUTE_POLICIES: Record<string, StudioRoutePolicy> = {
  [k('GET', '/ycode/api/api-keys')]: integrationPolicy('GET'),
  [k('POST', '/ycode/api/api-keys')]: integrationPolicy('POST'),
  [k('GET', '/ycode/api/api-keys/[id]')]: integrationPolicy('GET', 'id'),
  [k('DELETE', '/ycode/api/api-keys/[id]')]: integrationPolicy('DELETE', 'id'),

  [k('GET', '/ycode/api/apps')]: integrationPolicy('GET'),
  [k('GET', '/ycode/api/apps/[appId]/settings')]: integrationPolicy('GET', 'appId'),
  [k('PUT', '/ycode/api/apps/[appId]/settings')]: integrationPolicy('PUT', 'appId'),
  [k('DELETE', '/ycode/api/apps/[appId]/settings')]: integrationPolicy('DELETE', 'appId'),
  [k('GET', '/ycode/api/apps/mailerlite/fields')]: integrationPolicy('GET'),
  [k('GET', '/ycode/api/apps/mailerlite/groups')]: integrationPolicy('GET'),

  [k('GET', '/ycode/api/assets')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/assets')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/assets/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/assets/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/assets/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('POST', '/ycode/api/assets/bulk')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/assets/upload')]: projectPolicy('POST', STUDIO_WRITE_ROLES),

  [k('POST', '/ycode/api/auth/invite')]: projectPolicy('POST', STUDIO_OPERATOR_ROLES),
  [k('GET', '/ycode/api/auth/users')]: projectPolicy('GET', STUDIO_OPERATOR_ROLES),
  [k('PATCH', '/ycode/api/auth/users')]: projectPolicy('PATCH', STUDIO_OPERATOR_ROLES),
  [k('DELETE', '/ycode/api/auth/users')]: projectPolicy('DELETE', STUDIO_OPERATOR_ROLES),

  [k('GET', '/ycode/api/collections')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/collections')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/collections/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/collections/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/collections/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/collections/[id]/items')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('POST', '/ycode/api/collections/[id]/items')]: projectPolicy('POST', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/collections/[id]/items/[item_id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'item_id'),
  [k('PUT', '/ycode/api/collections/[id]/items/[item_id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'item_id'),
  [k('DELETE', '/ycode/api/collections/[id]/items/[item_id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'item_id'),
  [k('PUT', '/ycode/api/collections/[id]/items/[item_id]/status')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'item_id'),
  [k('GET', '/ycode/api/collections/[id]/items/[item_id]/values')]: projectPolicy('GET', STUDIO_READ_ROLES, 'item_id'),
  [k('PUT', '/ycode/api/collections/[id]/items/[item_id]/values')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'item_id'),
  [k('POST', '/ycode/api/collections/[id]/publish')]: projectPolicy('POST', ownerRoles, 'id'),
  [k('POST', '/ycode/api/collections/import/process')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/collections/items/delete')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/collections/items/publish')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/collections/sample')]: projectPolicy('POST', STUDIO_WRITE_ROLES),

  [k('GET', '/ycode/api/color-variables')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/color-variables')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('PUT', '/ycode/api/color-variables/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/color-variables/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('PUT', '/ycode/api/color-variables/reorder')]: projectPolicy('PUT', STUDIO_WRITE_ROLES),

  [k('GET', '/ycode/api/components')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/components')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/components/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/components/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('PATCH', '/ycode/api/components/[id]')]: projectPolicy('PATCH', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/components/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/components/unpublished')]: projectPolicy('GET', STUDIO_READ_ROLES),

  [k('GET', '/ycode/api/editor/init')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('GET', '/ycode/api/error-page')]: projectPolicy('GET', STUDIO_READ_ROLES),

  [k('DELETE', '/ycode/api/files/delete')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/files/presign')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/files/register')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/files/upload')]: projectPolicy('POST', STUDIO_WRITE_ROLES),

  [k('GET', '/ycode/api/folders')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/folders')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/folders/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/folders/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/folders/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('POST', '/ycode/api/folders/[id]/duplicate')]: projectPolicy('POST', STUDIO_WRITE_ROLES, 'id'),

  [k('GET', '/ycode/api/fonts')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/fonts')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/fonts/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/fonts/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/fonts/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),

  [k('GET', '/ycode/api/form-submissions')]: projectPolicy('GET', STUDIO_READ_ROLES),
  // TODO verify: public form creation uses resolvePublicFormSubmissionProjectScope(), not a StudioProjectRole gate.
  [k('POST', '/ycode/api/form-submissions')]: scopeOnlyPolicy('POST'),
  [k('DELETE', '/ycode/api/form-submissions')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/form-submissions/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/form-submissions/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/form-submissions/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),

  [k('GET', '/ycode/api/layer-styles')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/layer-styles')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/layer-styles/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/layer-styles/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('PATCH', '/ycode/api/layer-styles/[id]')]: projectPolicy('PATCH', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/layer-styles/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/layer-styles/unpublished')]: projectPolicy('GET', STUDIO_READ_ROLES),

  [k('GET', '/ycode/api/layers')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('PUT', '/ycode/api/layers')]: projectPolicy('PUT', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/layouts')]: projectPolicy('POST', STUDIO_WRITE_ROLES),

  [k('GET', '/ycode/api/locales')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/locales')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/locales/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/locales/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/locales/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('POST', '/ycode/api/locales/[id]/default')]: projectPolicy('POST', STUDIO_WRITE_ROLES, 'id'),

  [k('GET', '/ycode/api/mcp-tokens')]: projectPolicy('GET', ownerRoles),
  [k('POST', '/ycode/api/mcp-tokens')]: projectPolicy('POST', ownerRoles),
  [k('GET', '/ycode/api/mcp-tokens/[id]')]: projectPolicy('GET', ownerRoles, 'id'),
  [k('DELETE', '/ycode/api/mcp-tokens/[id]')]: projectPolicy('DELETE', ownerRoles, 'id'),

  [k('GET', '/ycode/api/pages')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/pages')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/pages/[id]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('PUT', '/ycode/api/pages/[id]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'id'),
  [k('DELETE', '/ycode/api/pages/[id]')]: projectPolicy('DELETE', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/pages/[id]/collection-item')]: projectPolicy('GET', STUDIO_READ_ROLES, 'id'),
  [k('POST', '/ycode/api/pages/[id]/duplicate')]: projectPolicy('POST', STUDIO_WRITE_ROLES, 'id'),
  [k('GET', '/ycode/api/pages/drafts')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('GET', '/ycode/api/pages/slug/[slug]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'slug'),
  [k('GET', '/ycode/api/pages/unpublished')]: projectPolicy('GET', STUDIO_READ_ROLES),

  [k('POST', '/ycode/api/publish')]: projectPolicy('POST', ownerRoles),
  [k('GET', '/ycode/api/publish/preview')]: projectPolicy('GET', STUDIO_READ_ROLES),
  [k('POST', '/ycode/api/revert')]: projectPolicy('POST', STUDIO_WRITE_ROLES),

  // TODO verify: key=email tightens to STUDIO_OPERATOR_ROLES via rolesForSettingKey().
  [k('GET', '/ycode/api/settings/[key]')]: projectPolicy('GET', STUDIO_READ_ROLES, 'key'),
  // TODO verify: key=email tightens to STUDIO_OPERATOR_ROLES via rolesForSettingKey().
  [k('PUT', '/ycode/api/settings/[key]')]: projectPolicy('PUT', STUDIO_WRITE_ROLES, 'key'),
  // TODO verify: any requested email setting tightens the batch write to STUDIO_OPERATOR_ROLES.
  [k('PUT', '/ycode/api/settings/batch')]: projectPolicy('PUT', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/settings/email/test')]: projectPolicy('POST', STUDIO_OPERATOR_ROLES),

  [k('POST', '/ycode/api/studio/preview-approval')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('POST', '/ycode/api/studio/preview-rendered')]: projectPolicy('POST', STUDIO_WRITE_ROLES),
  [k('GET', '/ycode/api/studio/publish-readiness')]: projectPolicy('GET', STUDIO_WRITE_ROLES),

  [k('GET', '/ycode/api/updates/check')]: projectPolicy('GET', STUDIO_OPERATOR_ROLES),
  [k('GET', '/ycode/api/updates/releases')]: projectPolicy('GET', STUDIO_OPERATOR_ROLES),

  [k('GET', '/ycode/api/webhooks')]: integrationPolicy('GET'),
  [k('POST', '/ycode/api/webhooks')]: integrationPolicy('POST'),
  [k('GET', '/ycode/api/webhooks/[id]')]: integrationPolicy('GET', 'id'),
  [k('PUT', '/ycode/api/webhooks/[id]')]: integrationPolicy('PUT', 'id'),
  [k('POST', '/ycode/api/webhooks/[id]')]: integrationPolicy('POST', 'id'),
  [k('DELETE', '/ycode/api/webhooks/[id]')]: integrationPolicy('DELETE', 'id'),
  [k('GET', '/ycode/api/webhooks/[id]/deliveries')]: integrationPolicy('GET', 'id'),

  // TODO verify: public collection filtering uses resolvePublicContentRequestProjectScope(), not a StudioProjectRole gate.
  [k('POST', '/ycode/api/collections/[id]/items/filter')]: scopeOnlyPolicy('POST', 'id'),
  // TODO verify: public load-more uses resolvePublicContentRequestProjectScope(), not a StudioProjectRole gate.
  [k('POST', '/ycode/api/collections/[id]/items/load-more')]: scopeOnlyPolicy('POST', 'id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/collections/[collection_id]/items')]: scopeOnlyPolicy('GET', 'collection_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('POST', '/ycode/api/v1/collections/[collection_id]/items')]: scopeOnlyPolicy('POST', 'collection_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/collections/[collection_id]/items/[item_id]')]: scopeOnlyPolicy('GET', 'item_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('PUT', '/ycode/api/v1/collections/[collection_id]/items/[item_id]')]: scopeOnlyPolicy('PUT', 'item_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('PATCH', '/ycode/api/v1/collections/[collection_id]/items/[item_id]')]: scopeOnlyPolicy('PATCH', 'item_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('DELETE', '/ycode/api/v1/collections/[collection_id]/items/[item_id]')]: scopeOnlyPolicy('DELETE', 'item_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/forms')]: scopeOnlyPolicy('GET'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/forms/[form_id]')]: scopeOnlyPolicy('GET', 'form_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/forms/[form_id]/submissions')]: scopeOnlyPolicy('GET', 'form_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('POST', '/ycode/api/v1/forms/[form_id]/submissions')]: scopeOnlyPolicy('POST', 'form_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('GET', '/ycode/api/v1/forms/[form_id]/submissions/[submission_id]')]: scopeOnlyPolicy('GET', 'submission_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('PATCH', '/ycode/api/v1/forms/[form_id]/submissions/[submission_id]')]: scopeOnlyPolicy('PATCH', 'submission_id'),
  // TODO verify: API-key project scope has no StudioProjectRole gate.
  [k('DELETE', '/ycode/api/v1/forms/[form_id]/submissions/[submission_id]')]: scopeOnlyPolicy('DELETE', 'submission_id'),
};
