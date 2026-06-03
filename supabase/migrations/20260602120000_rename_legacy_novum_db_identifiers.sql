do $$
declare
  item text[];
begin
  foreach item slice 1 in array array[
    array['studio_projects', 'novum_projects_pkey', 'studio_projects_pkey'],
    array['studio_projects', 'novum_projects_slug_key', 'studio_projects_slug_key'],
    array['studio_projects', 'novum_projects_status_check', 'studio_projects_status_check'],
    array['studio_project_memberships', 'novum_project_memberships_pkey', 'studio_project_memberships_pkey'],
    array['studio_project_memberships', 'novum_project_memberships_project_id_fkey', 'studio_project_memberships_project_id_fkey'],
    array['studio_project_memberships', 'novum_project_memberships_project_id_user_id_key', 'studio_project_memberships_project_id_user_id_key'],
    array['studio_project_memberships', 'novum_project_memberships_user_id_fkey', 'studio_project_memberships_user_id_fkey'],
    array['studio_audit_logs', 'novum_audit_logs_pkey', 'studio_audit_logs_pkey'],
    array['studio_audit_logs', 'novum_audit_logs_project_id_fkey', 'studio_audit_logs_project_id_fkey'],
    array['studio_audit_logs', 'novum_audit_logs_actor_user_id_fkey', 'studio_audit_logs_actor_user_id_fkey'],
    array['studio_preview_runs', 'novum_preview_runs_pkey', 'studio_preview_runs_pkey'],
    array['studio_preview_runs', 'novum_preview_runs_project_id_fkey', 'studio_preview_runs_project_id_fkey'],
    array['studio_preview_runs', 'novum_preview_runs_actor_user_id_fkey', 'studio_preview_runs_actor_user_id_fkey'],
    array['studio_preview_runs', 'novum_preview_runs_source_check', 'studio_preview_runs_source_check'],
    array['studio_preview_runs', 'novum_preview_runs_status_check', 'studio_preview_runs_status_check'],
    array['studio_custom_code_events', 'novum_custom_code_events_pkey', 'studio_custom_code_events_pkey'],
    array['studio_custom_code_events', 'novum_custom_code_events_project_id_fkey', 'studio_custom_code_events_project_id_fkey'],
    array['studio_custom_code_events', 'novum_custom_code_events_actor_user_id_fkey', 'studio_custom_code_events_actor_user_id_fkey'],
    array['studio_custom_code_events', 'novum_custom_code_events_scope_check', 'studio_custom_code_events_scope_check'],
    array['studio_custom_code_events', 'novum_custom_code_events_secret_scan_status_check', 'studio_custom_code_events_secret_scan_status_check'],
    array['studio_backups', 'novum_backups_pkey', 'studio_backups_pkey'],
    array['studio_backups', 'novum_backups_project_id_fkey', 'studio_backups_project_id_fkey'],
    array['studio_backups', 'novum_backups_created_by_fkey', 'studio_backups_created_by_fkey'],
    array['studio_backups', 'novum_backups_backup_kind_check', 'studio_backups_backup_kind_check'],
    array['studio_backups', 'novum_backups_status_check', 'studio_backups_status_check']
  ] loop
    if exists (
      select 1
      from pg_constraint
      where conname = item[2]
        and conrelid = ('public.' || item[1])::regclass
    ) and not exists (
      select 1
      from pg_constraint
      where conname = item[3]
        and conrelid = ('public.' || item[1])::regclass
    ) then
      execute format('alter table public.%I rename constraint %I to %I', item[1], item[2], item[3]);
    end if;
  end loop;
end $$;

drop index if exists public.novum_audit_logs_project_created_idx;
drop index if exists public.novum_backups_project_created_idx;
drop index if exists public.novum_custom_code_events_project_created_idx;
drop index if exists public.novum_preview_runs_project_created_idx;
drop index if exists public.novum_project_memberships_project_idx;
drop index if exists public.novum_project_memberships_user_idx;
