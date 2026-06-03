import type { Knex } from 'knex';

const LEGACY_CONSTRAINT_RENAMES = [
  ['studio_projects', 'novum_projects_pkey', 'studio_projects_pkey'],
  ['studio_projects', 'novum_projects_slug_key', 'studio_projects_slug_key'],
  ['studio_projects', 'novum_projects_status_check', 'studio_projects_status_check'],
  ['studio_project_memberships', 'novum_project_memberships_pkey', 'studio_project_memberships_pkey'],
  ['studio_project_memberships', 'novum_project_memberships_project_id_fkey', 'studio_project_memberships_project_id_fkey'],
  ['studio_project_memberships', 'novum_project_memberships_project_id_user_id_key', 'studio_project_memberships_project_id_user_id_key'],
  ['studio_project_memberships', 'novum_project_memberships_user_id_fkey', 'studio_project_memberships_user_id_fkey'],
  ['studio_audit_logs', 'novum_audit_logs_pkey', 'studio_audit_logs_pkey'],
  ['studio_audit_logs', 'novum_audit_logs_project_id_fkey', 'studio_audit_logs_project_id_fkey'],
  ['studio_audit_logs', 'novum_audit_logs_actor_user_id_fkey', 'studio_audit_logs_actor_user_id_fkey'],
  ['studio_preview_runs', 'novum_preview_runs_pkey', 'studio_preview_runs_pkey'],
  ['studio_preview_runs', 'novum_preview_runs_project_id_fkey', 'studio_preview_runs_project_id_fkey'],
  ['studio_preview_runs', 'novum_preview_runs_actor_user_id_fkey', 'studio_preview_runs_actor_user_id_fkey'],
  ['studio_preview_runs', 'novum_preview_runs_source_check', 'studio_preview_runs_source_check'],
  ['studio_preview_runs', 'novum_preview_runs_status_check', 'studio_preview_runs_status_check'],
  ['studio_custom_code_events', 'novum_custom_code_events_pkey', 'studio_custom_code_events_pkey'],
  ['studio_custom_code_events', 'novum_custom_code_events_project_id_fkey', 'studio_custom_code_events_project_id_fkey'],
  ['studio_custom_code_events', 'novum_custom_code_events_actor_user_id_fkey', 'studio_custom_code_events_actor_user_id_fkey'],
  ['studio_custom_code_events', 'novum_custom_code_events_scope_check', 'studio_custom_code_events_scope_check'],
  [
    'studio_custom_code_events',
    'novum_custom_code_events_secret_scan_status_check',
    'studio_custom_code_events_secret_scan_status_check',
  ],
  ['studio_backups', 'novum_backups_pkey', 'studio_backups_pkey'],
  ['studio_backups', 'novum_backups_project_id_fkey', 'studio_backups_project_id_fkey'],
  ['studio_backups', 'novum_backups_created_by_fkey', 'studio_backups_created_by_fkey'],
  ['studio_backups', 'novum_backups_backup_kind_check', 'studio_backups_backup_kind_check'],
  ['studio_backups', 'novum_backups_status_check', 'studio_backups_status_check'],
] as const;

const LEGACY_DUPLICATE_INDEXES = [
  'novum_audit_logs_project_created_idx',
  'novum_backups_project_created_idx',
  'novum_custom_code_events_project_created_idx',
  'novum_preview_runs_project_created_idx',
  'novum_project_memberships_project_idx',
  'novum_project_memberships_user_idx',
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const [tableName, legacyName, studioName] of LEGACY_CONSTRAINT_RENAMES) {
    await knex.schema.raw(`
      do $$
      begin
        if exists (
          select 1
          from pg_constraint
          where conname = '${legacyName}'
            and conrelid = 'public.${tableName}'::regclass
        ) and not exists (
          select 1
          from pg_constraint
          where conname = '${studioName}'
            and conrelid = 'public.${tableName}'::regclass
        ) then
          alter table public.${tableName}
          rename constraint ${legacyName} to ${studioName};
        end if;
      end $$;
    `);
  }

  for (const indexName of LEGACY_DUPLICATE_INDEXES) {
    await knex.schema.raw(`drop index if exists public.${indexName}`);
  }
}

export async function down(): Promise<void> {
  // Intentionally irreversible: reverting to legacy Novum DB identifiers would
  // reintroduce the naming drift this migration removes.
}
