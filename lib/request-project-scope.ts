import type { NextRequest } from 'next/server';
import {
  projectLookupFromHost,
  resolveCurrentYcodeSiteProjectId,
  resolveSingleStudioProjectIdForCurrentUser,
  resolveStudioProjectId,
} from '@/lib/project-scope';
import { canAccessStudioProject } from '@/lib/studio-platform';

export class ProjectScopeAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectScopeAuthorizationError';
  }
}

function explicitProjectLookup(request: NextRequest): string | null {
  const { searchParams } = new URL(request.url);
  return request.headers.get('x-studio-project-slug') || searchParams.get('project');
}

function hostProjectLookup(request: NextRequest): string | null {
  return projectLookupFromHost(
    request.headers.get('host') || request.headers.get('x-forwarded-host')
  );
}

export type PublicFormDefinitionState = 'draft' | 'published' | 'any';

export type PublicFormSubmissionProjectScope = {
  projectId: string | null;
  definitionState: PublicFormDefinitionState;
};

export type PublicContentRequestProjectScope = {
  projectId: string | null;
  source: 'host' | 'site-key' | 'authenticated-preview' | 'none';
};

export async function resolveRequestProjectId(request: NextRequest): Promise<string | null> {
  const projectLookup = explicitProjectLookup(request);
  if (projectLookup) return resolveStudioProjectId(projectLookup);
  const hostLookup = hostProjectLookup(request);
  if (hostLookup) return resolveStudioProjectId(hostLookup);
  const siteProjectId = await resolveCurrentYcodeSiteProjectId();
  if (siteProjectId) return siteProjectId;
  return resolveSingleStudioProjectIdForCurrentUser();
}

export async function resolvePublicContentRequestProjectScope(request: NextRequest): Promise<PublicContentRequestProjectScope> {
  const hostLookup = hostProjectLookup(request);
  if (hostLookup) {
    return {
      projectId: await resolveStudioProjectId(hostLookup),
      source: 'host',
    };
  }

  const siteProjectId = await resolveCurrentYcodeSiteProjectId();
  if (siteProjectId) {
    return {
      projectId: siteProjectId,
      source: 'site-key',
    };
  }

  const projectLookup = explicitProjectLookup(request);
  if (!projectLookup) return { projectId: null, source: 'none' };

  const projectId = await resolveStudioProjectId(projectLookup);
  if (!projectId) return { projectId: null, source: 'none' };

  const canAccessPreviewProject = await canAccessStudioProject(projectId, [
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!canAccessPreviewProject) {
    throw new Error('Not authorized for requested preview project');
  }

  return { projectId, source: 'authenticated-preview' };
}

export async function resolvePublicContentRequestProjectId(request: NextRequest): Promise<string | null> {
  return (await resolvePublicContentRequestProjectScope(request)).projectId;
}

export async function resolvePublicFormSubmissionProjectScope(
  request: NextRequest
): Promise<PublicFormSubmissionProjectScope> {
  const hostLookup = hostProjectLookup(request);
  if (hostLookup) {
    const hostProjectId = await resolveStudioProjectId(hostLookup);
    if (hostProjectId) {
      return { projectId: hostProjectId, definitionState: 'published' };
    }
    return { projectId: null, definitionState: 'published' };
  }

  const siteProjectId = await resolveCurrentYcodeSiteProjectId();
  if (siteProjectId) {
    return { projectId: siteProjectId, definitionState: 'published' };
  }

  const projectLookup = explicitProjectLookup(request);
  if (!projectLookup) return { projectId: null, definitionState: 'any' };

  const projectId = await resolveStudioProjectId(projectLookup);
  if (!projectId) return { projectId: null, definitionState: 'any' };

  const canAccessPreviewProject = await canAccessStudioProject(projectId, [
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!canAccessPreviewProject) {
    throw new Error('Not authorized for requested preview project');
  }

  return { projectId, definitionState: 'draft' };
}

export async function resolvePublicFormSubmissionProjectId(request: NextRequest): Promise<string | null> {
  return (await resolvePublicFormSubmissionProjectScope(request)).projectId;
}

export async function resolveApiKeyRequestProjectId(
  request: NextRequest,
  apiKeyProjectId?: string | null
): Promise<string | null> {
  if (!apiKeyProjectId) {
    throw new ProjectScopeAuthorizationError('API key is not bound to a project');
  }

  const requestProjectId = await resolveRequestProjectId(request);
  if (requestProjectId && requestProjectId !== apiKeyProjectId) {
    throw new ProjectScopeAuthorizationError('API key is not authorized for the requested project');
  }
  return apiKeyProjectId;
}
