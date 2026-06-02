alter table if exists public.mcp_tokens
add column if not exists project_id uuid;

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
    update public.mcp_tokens
    set project_id = fallback_project_id
    where project_id is null;
  end if;
end $$;

delete from public.mcp_tokens where project_id is null;

alter table public.mcp_tokens
alter column project_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mcp_tokens_project_id_fkey'
      and conrelid = 'public.mcp_tokens'::regclass
  ) then
    alter table public.mcp_tokens
    add constraint mcp_tokens_project_id_fkey
    foreign key (project_id)
    references public.studio_projects(id)
    on delete cascade;
  end if;
end $$;

create index if not exists idx_mcp_tokens_project_id
on public.mcp_tokens(project_id);
