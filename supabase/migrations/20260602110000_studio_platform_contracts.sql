-- Studio platform foundation.
-- Canonical product-owned tables for project assignment, audit trail, preview
-- evidence, custom-code gates, and backup metadata.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regclass('public.studio_projects') is null and to_regclass('public.novum_projects') is not null then
    alter table public.novum_projects rename to studio_projects;
  end if;

  if to_regclass('public.studio_project_memberships') is null and to_regclass('public.novum_project_memberships') is not null then
    alter table public.novum_project_memberships rename to studio_project_memberships;
  end if;

  if to_regclass('public.studio_audit_logs') is null and to_regclass('public.novum_audit_logs') is not null then
    alter table public.novum_audit_logs rename to studio_audit_logs;
  end if;

  if to_regclass('public.studio_preview_runs') is null and to_regclass('public.novum_preview_runs') is not null then
    alter table public.novum_preview_runs rename to studio_preview_runs;
  end if;

  if to_regclass('public.studio_custom_code_events') is null and to_regclass('public.novum_custom_code_events') is not null then
    alter table public.novum_custom_code_events rename to studio_custom_code_events;
  end if;

  if to_regclass('public.studio_backups') is null and to_regclass('public.novum_backups') is not null then
    alter table public.novum_backups rename to studio_backups;
  end if;

  if to_regprocedure('public.studio_set_updated_at()') is null and to_regprocedure('public.novum_set_updated_at()') is not null then
    alter function public.novum_set_updated_at() rename to studio_set_updated_at;
  end if;
end $$;

create or replace function public.studio_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  primary_domain text,
  ycode_site_key text not null default 'default',
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_project_memberships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

alter table public.studio_project_memberships
  drop constraint if exists studio_project_memberships_role_check;
alter table public.studio_project_memberships
  drop constraint if exists novum_project_memberships_role_check;

update public.studio_project_memberships
set role = 'studio_admin'
where role = 'novum_admin';

update public.studio_project_memberships
set role = 'studio_developer'
where role = 'novum_developer';

alter table public.studio_project_memberships
  add constraint studio_project_memberships_role_check
  check (role in (
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
    'customer_viewer'
  ));

create table if not exists public.studio_audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.studio_projects(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_preview_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'ycode_preview'
    check (source in ('ycode_preview', 'vercel_preview')),
  preview_url text not null,
  draft_hash text,
  status text not null default 'created'
    check (status in ('created', 'failed', 'expired')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_custom_code_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  scope text not null
    check (scope in ('global', 'page', 'component', 'embed')),
  target_id text,
  content_hash text not null,
  secret_scan_status text not null default 'pending'
    check (secret_scan_status in ('pending', 'clean', 'warning', 'blocked')),
  secret_scan_findings jsonb not null default '[]'::jsonb,
  preview_required boolean not null default true,
  preview_checked_at timestamptz,
  live_warning_ack_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.studio_backups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  backup_kind text not null
    check (backup_kind in ('pre_publish', 'manual', 'scheduled', 'restore_point')),
  storage_bucket text,
  storage_path text,
  status text not null default 'created'
    check (status in ('created', 'restored', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop trigger if exists novum_projects_set_updated_at on public.studio_projects;
drop trigger if exists studio_projects_set_updated_at on public.studio_projects;
create trigger studio_projects_set_updated_at
before update on public.studio_projects
for each row execute function public.studio_set_updated_at();

create index if not exists studio_project_memberships_user_idx
  on public.studio_project_memberships(user_id);
create index if not exists studio_project_memberships_project_idx
  on public.studio_project_memberships(project_id);
create index if not exists studio_audit_logs_project_created_idx
  on public.studio_audit_logs(project_id, created_at desc);
create index if not exists studio_preview_runs_project_created_idx
  on public.studio_preview_runs(project_id, created_at desc);
create unique index if not exists studio_preview_runs_raw_nonce_hash_unique
  on public.studio_preview_runs ((metadata->>'rawNonceHash'))
  where metadata->>'rawNonceHash' is not null;
create index if not exists studio_custom_code_events_project_created_idx
  on public.studio_custom_code_events(project_id, created_at desc);
create index if not exists studio_backups_project_created_idx
  on public.studio_backups(project_id, created_at desc);

drop index if exists public.novum_preview_runs_raw_nonce_hash_unique;

alter table public.studio_projects enable row level security;
alter table public.studio_project_memberships enable row level security;
alter table public.studio_audit_logs enable row level security;
alter table public.studio_preview_runs enable row level security;
alter table public.studio_custom_code_events enable row level security;
alter table public.studio_backups enable row level security;

grant select on public.studio_projects to authenticated;
grant select on public.studio_project_memberships to authenticated;
grant select on public.studio_audit_logs to authenticated;
grant select on public.studio_preview_runs to authenticated;
grant select on public.studio_custom_code_events to authenticated;
grant select on public.studio_backups to authenticated;

drop policy if exists "Novum members can read assigned projects" on public.studio_projects;
drop policy if exists "Studio members can read assigned projects" on public.studio_projects;
create policy "Studio members can read assigned projects"
on public.studio_projects
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_project_memberships m
    where m.project_id = studio_projects.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Novum users can read own memberships" on public.studio_project_memberships;
drop policy if exists "Studio users can read own memberships" on public.studio_project_memberships;
create policy "Studio users can read own memberships"
on public.studio_project_memberships
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Novum members can read project audit logs" on public.studio_audit_logs;
drop policy if exists "Studio members can read project audit logs" on public.studio_audit_logs;
create policy "Studio members can read project audit logs"
on public.studio_audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_project_memberships m
    where m.project_id = studio_audit_logs.project_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Novum members can read preview runs" on public.studio_preview_runs;
drop policy if exists "Studio members can read preview runs" on public.studio_preview_runs;
create policy "Studio members can read preview runs"
on public.studio_preview_runs
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_project_memberships m
    where m.project_id = studio_preview_runs.project_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Novum members can read custom code events" on public.studio_custom_code_events;
drop policy if exists "Studio members can read custom code events" on public.studio_custom_code_events;
create policy "Studio members can read custom code events"
on public.studio_custom_code_events
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_project_memberships m
    where m.project_id = studio_custom_code_events.project_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "Novum members can read backup metadata" on public.studio_backups;
drop policy if exists "Studio members can read backup metadata" on public.studio_backups;
create policy "Studio members can read backup metadata"
on public.studio_backups
for select
to authenticated
using (
  exists (
    select 1
    from public.studio_project_memberships m
    where m.project_id = studio_backups.project_id
      and m.user_id = auth.uid()
  )
);
