alter table if exists public.settings add column if not exists project_id uuid;
alter table if exists public.page_folders add column if not exists project_id uuid;
alter table if exists public.pages add column if not exists project_id uuid;
alter table if exists public.page_layers add column if not exists project_id uuid;
alter table if exists public.collections add column if not exists project_id uuid;
alter table if exists public.collection_fields add column if not exists project_id uuid;
alter table if exists public.collection_items add column if not exists project_id uuid;
alter table if exists public.collection_item_values add column if not exists project_id uuid;
alter table if exists public.assets add column if not exists project_id uuid;
alter table if exists public.asset_folders add column if not exists project_id uuid;
alter table if exists public.components add column if not exists project_id uuid;
alter table if exists public.layer_styles add column if not exists project_id uuid;
alter table if exists public.color_variables add column if not exists project_id uuid;
alter table if exists public.fonts add column if not exists project_id uuid;
alter table if exists public.locales add column if not exists project_id uuid;
alter table if exists public.translations add column if not exists project_id uuid;
alter table if exists public.form_submissions add column if not exists project_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'settings_project_id_fkey' and conrelid = 'public.settings'::regclass) then
    alter table public.settings add constraint settings_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'page_folders_project_id_fkey' and conrelid = 'public.page_folders'::regclass) then
    alter table public.page_folders add constraint page_folders_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pages_project_id_fkey' and conrelid = 'public.pages'::regclass) then
    alter table public.pages add constraint pages_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'page_layers_project_id_fkey' and conrelid = 'public.page_layers'::regclass) then
    alter table public.page_layers add constraint page_layers_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collections_project_id_fkey' and conrelid = 'public.collections'::regclass) then
    alter table public.collections add constraint collections_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collection_fields_project_id_fkey' and conrelid = 'public.collection_fields'::regclass) then
    alter table public.collection_fields add constraint collection_fields_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collection_items_project_id_fkey' and conrelid = 'public.collection_items'::regclass) then
    alter table public.collection_items add constraint collection_items_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collection_item_values_project_id_fkey' and conrelid = 'public.collection_item_values'::regclass) then
    alter table public.collection_item_values add constraint collection_item_values_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_project_id_fkey' and conrelid = 'public.assets'::regclass) then
    alter table public.assets add constraint assets_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_folders_project_id_fkey' and conrelid = 'public.asset_folders'::regclass) then
    alter table public.asset_folders add constraint asset_folders_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'components_project_id_fkey' and conrelid = 'public.components'::regclass) then
    alter table public.components add constraint components_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'layer_styles_project_id_fkey' and conrelid = 'public.layer_styles'::regclass) then
    alter table public.layer_styles add constraint layer_styles_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'color_variables_project_id_fkey' and conrelid = 'public.color_variables'::regclass) then
    alter table public.color_variables add constraint color_variables_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fonts_project_id_fkey' and conrelid = 'public.fonts'::regclass) then
    alter table public.fonts add constraint fonts_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'locales_project_id_fkey' and conrelid = 'public.locales'::regclass) then
    alter table public.locales add constraint locales_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'translations_project_id_fkey' and conrelid = 'public.translations'::regclass) then
    alter table public.translations add constraint translations_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'form_submissions_project_id_fkey' and conrelid = 'public.form_submissions'::regclass) then
    alter table public.form_submissions add constraint form_submissions_project_id_fkey foreign key (project_id) references public.studio_projects(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_settings_project_id on public.settings(project_id);
create index if not exists idx_page_folders_project_id on public.page_folders(project_id);
create index if not exists idx_pages_project_id on public.pages(project_id);
create index if not exists idx_page_layers_project_id on public.page_layers(project_id);
create index if not exists idx_collections_project_id on public.collections(project_id);
create index if not exists idx_collection_fields_project_id on public.collection_fields(project_id);
create index if not exists idx_collection_items_project_id on public.collection_items(project_id);
create index if not exists idx_collection_item_values_project_id on public.collection_item_values(project_id);
create index if not exists idx_assets_project_id on public.assets(project_id);
create index if not exists idx_asset_folders_project_id on public.asset_folders(project_id);
create index if not exists idx_components_project_id on public.components(project_id);
create index if not exists idx_layer_styles_project_id on public.layer_styles(project_id);
create index if not exists idx_color_variables_project_id on public.color_variables(project_id);
create index if not exists idx_fonts_project_id on public.fonts(project_id);
create index if not exists idx_locales_project_id on public.locales(project_id);
create index if not exists idx_translations_project_id on public.translations(project_id);
create index if not exists idx_form_submissions_project_id on public.form_submissions(project_id);

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

alter table public.settings drop constraint if exists settings_key_key;
alter table public.settings drop constraint if exists settings_project_id_key_unique;
drop index if exists public.settings_key_key;
alter table public.settings add constraint settings_project_id_key_unique unique (project_id, key);

drop index if exists public.pages_slug_is_published_folder_unique;
create unique index if not exists pages_project_slug_is_published_folder_unique
on public.pages(
  project_id,
  slug,
  is_published,
  coalesce(page_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(error_page, 0)
)
where deleted_at is null and is_dynamic = false;

alter table public.page_folders drop constraint if exists page_folders_project_id_id_is_published_unique;
alter table public.page_folders
add constraint page_folders_project_id_id_is_published_unique
unique (project_id, id, is_published);

alter table public.pages drop constraint if exists pages_project_folder_fkey;
alter table public.pages
add constraint pages_project_folder_fkey
foreign key (project_id, page_folder_id, is_published)
references public.page_folders(project_id, id, is_published)
on update cascade;

alter table public.page_folders drop constraint if exists page_folders_project_parent_fkey;
alter table public.page_folders
add constraint page_folders_project_parent_fkey
foreign key (project_id, page_folder_id, is_published)
references public.page_folders(project_id, id, is_published)
on update cascade;

create index if not exists idx_page_layers_project_page_id
on public.page_layers(project_id, page_id, is_published)
where deleted_at is null;

create index if not exists idx_collection_items_project_collection
on public.collection_items(project_id, collection_id, is_published)
where deleted_at is null;

create index if not exists idx_collection_item_values_project_item
on public.collection_item_values(project_id, item_id, is_published)
where deleted_at is null;

create index if not exists idx_collection_fields_project_collection
on public.collection_fields(project_id, collection_id, is_published)
where deleted_at is null;

create index if not exists idx_assets_project_published
on public.assets(project_id, is_published);
