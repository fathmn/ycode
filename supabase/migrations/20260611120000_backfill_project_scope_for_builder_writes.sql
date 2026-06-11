-- Backfill project_id for rows created by builder write paths that did not yet
-- set a project scope (assets/fonts/components/layer_styles/collections inserts
-- before the route-level project plumbing landed).
-- Mirrors the fallback semantics of 20260602113000: assign to the oldest active
-- studio project. Safe to re-run (only touches rows where project_id is null).

do $$
declare
  fallback_project_id uuid;
  active_project_count integer;
begin
  select count(*) into active_project_count
  from public.studio_projects
  where status = 'active';

  -- Only backfill unambiguously: with multiple active projects a null row
  -- cannot be attributed safely and must be resolved manually.
  if active_project_count <> 1 then
    raise notice 'Skipping project scope backfill: % active studio projects', active_project_count;
    return;
  end if;

  select id
  into fallback_project_id
  from public.studio_projects
  where status = 'active'
  order by created_at asc
  limit 1;

  if fallback_project_id is not null then
    update public.settings set project_id = fallback_project_id where project_id is null;
    update public.page_folders set project_id = fallback_project_id where project_id is null;
    update public.pages set project_id = fallback_project_id where project_id is null;
    update public.page_layers set project_id = fallback_project_id where project_id is null;
    update public.collections set project_id = fallback_project_id where project_id is null;
    update public.collection_fields set project_id = fallback_project_id where project_id is null;
    update public.collection_items set project_id = fallback_project_id where project_id is null;
    update public.collection_item_values set project_id = fallback_project_id where project_id is null;
    update public.assets set project_id = fallback_project_id where project_id is null;
    update public.asset_folders set project_id = fallback_project_id where project_id is null;
    update public.components set project_id = fallback_project_id where project_id is null;
    update public.layer_styles set project_id = fallback_project_id where project_id is null;
    update public.color_variables set project_id = fallback_project_id where project_id is null;
    update public.fonts set project_id = fallback_project_id where project_id is null;
    update public.locales set project_id = fallback_project_id where project_id is null;
    update public.translations set project_id = fallback_project_id where project_id is null;
    update public.form_submissions set project_id = fallback_project_id where project_id is null;
  end if;
end $$;
