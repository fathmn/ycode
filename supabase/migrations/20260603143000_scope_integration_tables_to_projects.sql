alter table if exists public.app_settings add column if not exists project_id uuid;
alter table if exists public.webhooks add column if not exists project_id uuid;
alter table if exists public.webhook_deliveries add column if not exists project_id uuid;
alter table if exists public.api_keys add column if not exists project_id uuid;

do $$
declare
  fallback_project_id uuid;
begin
  select id
  into fallback_project_id
  from public.studio_projects
  where status = 'active'
  order by created_at asc
  limit 1;

  if fallback_project_id is not null then
    update public.app_settings set project_id = fallback_project_id where project_id is null;
    update public.webhooks set project_id = fallback_project_id where project_id is null;
    update public.webhook_deliveries set project_id = fallback_project_id where project_id is null;
    update public.api_keys set project_id = fallback_project_id where project_id is null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.app_settings') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'app_settings_project_id_fkey'
        and conrelid = 'public.app_settings'::regclass
    )
  then
    alter table public.app_settings
    add constraint app_settings_project_id_fkey
    foreign key (project_id)
    references public.studio_projects(id)
    on delete cascade;
  end if;

  if to_regclass('public.webhooks') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'webhooks_project_id_fkey'
        and conrelid = 'public.webhooks'::regclass
    )
  then
    alter table public.webhooks
    add constraint webhooks_project_id_fkey
    foreign key (project_id)
    references public.studio_projects(id)
    on delete cascade;
  end if;

  if to_regclass('public.webhook_deliveries') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'webhook_deliveries_project_id_fkey'
        and conrelid = 'public.webhook_deliveries'::regclass
    )
  then
    alter table public.webhook_deliveries
    add constraint webhook_deliveries_project_id_fkey
    foreign key (project_id)
    references public.studio_projects(id)
    on delete cascade;
  end if;

  if to_regclass('public.api_keys') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'api_keys_project_id_fkey'
        and conrelid = 'public.api_keys'::regclass
    )
  then
    alter table public.api_keys
    add constraint api_keys_project_id_fkey
    foreign key (project_id)
    references public.studio_projects(id)
    on delete cascade;
  end if;
end $$;

alter table if exists public.app_settings drop constraint if exists app_settings_app_id_key_key;
alter table if exists public.app_settings drop constraint if exists app_settings_app_id_key_unique;
drop index if exists public.app_settings_app_id_key_key;
drop index if exists public.app_settings_app_id_key_unique;

create index if not exists idx_app_settings_project_id on public.app_settings(project_id);
create index if not exists idx_webhooks_project_id on public.webhooks(project_id);
create index if not exists idx_webhook_deliveries_project_id on public.webhook_deliveries(project_id);
create index if not exists idx_api_keys_project_id on public.api_keys(project_id);

create unique index if not exists app_settings_project_app_key_unique
on public.app_settings(project_id, app_id, key);
