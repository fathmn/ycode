import type { NextRequest } from 'next/server';
import { projectLookupFromHost, resolveNovumProjectId, resolveSingleNovumProjectIdForCurrentUser } from '@/lib/project-scope';
import { canAccessNovumProject } from '@/lib/novum-platform';

export class ProjectScopeAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectScopeAuthorizationError';
  }
}

function explicitProjectLookup(request: NextRequest): string | null {
  const { searchParams } = new URL(request.url);
  return request.headers.get('x-novum-project-slug') || searchParams.get('project');
}

function hostProjectLookup(request: NextRequest): string | null {
  return projectLookupFromHost(
    request.headers.get('x-forwarded-host') || request.headers.get('host')
  );
}

export type PublicFormDefinitionState = 'draft' | 'published' | 'any';

export type PublicFormSubmissionProjectScope = {
  projectId: string | null;
  definitionState: PublicFormDefinitionState;
};

export async function resolveRequestProjectId(request: NextRequest): Promise<string | null> {
  const projectLookup = explicitProjectLookup(request);
  if (projectLookup) return resolveNovumProjectId(projectLookup);
  const hostLookup = hostProjectLookup(request);
  if (hostLookup) return resolveNovumProjectId(hostLookup);
  return resolveSingleNovumProjectIdForCurrentUser();
}

export async function resolvePublicFormSubmissionProjectScope(
  request: NextRequest
): Promise<PublicFormSubmissionProjectScope> {
  const hostLookup = hostProjectLookup(request);
  if (hostLookup) {
    const hostProjectId = await resolveNovumProjectId(hostLookup);
    if (hostProjectId) {
      return { projectId: hostProjectId, definitionState: 'published' };
    }
  }

  const projectLookup = explicitProjectLookup(request);
  if (!projectLookup) return { projectId: null, definitionState: 'any' };

  const projectId = await resolveNovumProjectId(projectLookup);
  if (!projectId) return { projectId: null, definitionState: 'any' };

  const canAccessPreviewProject = await canAccessNovumProject(projectId, [
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
