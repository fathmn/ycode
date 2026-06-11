import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';
import CustomCodeInjector from '@/components/CustomCodeInjector';
import { canRenderStudioCustomCode } from '@/lib/studio-platform';
import { resolveSingleStudioProjectIdForCurrentUser } from '@/lib/project-scope';

/** Preview layout — injects global custom body code. Head code is handled by root layout. */
export default async function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the current user's project and gate custom code behind the studio
  // secret scan. If no project can be resolved, fail closed and render nothing.
  const projectId = await resolveSingleStudioProjectIdForCurrentUser();
  const allowCustomCode = await canRenderStudioCustomCode(projectId, false, { requireProject: true });

  let globalCustomCodeBody: string | null = null;
  if (allowCustomCode) {
    const settings = await getSettingsByKeys(['custom_code_body'], projectId);
    globalCustomCodeBody = settings.custom_code_body as string | null;
  }

  return (
    <>
      {children}
      {globalCustomCodeBody && (
        <CustomCodeInjector html={globalCustomCodeBody} />
      )}
    </>
  );
}
